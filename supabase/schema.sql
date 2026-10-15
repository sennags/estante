-- Lirismo: banco da conta. Rodar uma vez no SQL Editor do Supabase.
-- O navegador continua sendo a fonte da verdade; aqui fica uma cópia,
-- uma linha por registro de qualquer tabela local.

create sequence if not exists records_rev;

create table if not exists records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('stories', 'chapters', 'versions', 'entries', 'scenes', 'threads')),
  id text not null,
  data jsonb,                              -- o registro inteiro, como está no navegador
  deleted boolean not null default false,  -- apagado: os outros aparelhos ficam sabendo
  rev bigint not null default nextval('records_rev'),
  primary key (user_id, kind, id)
);

create index if not exists records_user_rev on records (user_id, rev);

-- Quando a linha foi gravada pela última vez (o trigger do rev atualiza). A
-- limpeza das exclusões usa: ver "Exclusões antigas", abaixo.
alter table records add column if not exists updated_at timestamptz not null default now();

alter table records enable row level security;

-- Só quem entrou na conta acessa a tabela (e só as próprias linhas, pela regra abaixo).
revoke all on records from anon;
grant select, insert, update, delete on records to authenticated;
grant usage on sequence records_rev to authenticated;

drop policy if exists "dono" on records;
create policy "dono" on records for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A cada gravação, um rev novo. A trava por usuário garante que os revs de
-- uma conta fiquem visíveis na ordem: quem busca "rev > último visto" nunca
-- pula uma linha que ainda estava sendo gravada.
create or replace function records_next_rev() returns trigger
language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  new.rev := nextval('records_rev');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists records_rev on records;
create trigger records_rev before insert or update on records
  for each row execute function records_next_rev();

-- Limites por conta, para uma conta sozinha não encher o banco (o plano grátis
-- tem 500 MB). Quem passa do limite recebe o erro 'lirismo_quota', e o app
-- avisa que a nuvem da conta está cheia. Apagar e encolher passam sempre, para
-- quem está cheio conseguir liberar espaço. A maior parte do espaço é das
-- versões dos capítulos (até 2 por capítulo). O app separa o registro que
-- passa de 5 MB e segue enviando o resto (src/sync/engine.tsx). Para mudar
-- os limites, troque os números e rode de novo.
alter table records drop constraint if exists records_id_len;
alter table records add constraint records_id_len check (length(id) <= 64);
alter table records drop constraint if exists records_data_size;
alter table records add constraint records_data_size check (pg_column_size(data) <= 5 * 1024 * 1024);

create or replace function records_quota() returns trigger
language plpgsql set search_path = public as $$
declare
  added_rows bigint := 0;
  added_bytes bigint;
  total_rows bigint;
  total_bytes bigint;
begin
  -- Sem usuário (painel do Supabase, service_role): sem limite.
  if auth.uid() is null then return null; end if;
  -- Antes de contar, saem as exclusões antigas da conta (ver abaixo).
  perform private.purge_tombstones(auth.uid());
  if tg_op = 'INSERT' then
    select count(*), coalesce(sum(pg_column_size(data)), 0) into added_rows, added_bytes from new_rows;
  else
    select coalesce(sum(pg_column_size(data)), 0) into added_bytes from new_rows;
    added_bytes := added_bytes - (select coalesce(sum(pg_column_size(data)), 0) from old_rows);
  end if;
  if added_rows = 0 and added_bytes <= 0 then return null; end if;
  select count(*), coalesce(sum(pg_column_size(data)), 0) into total_rows, total_bytes
    from records where user_id = auth.uid();
  if total_rows > 50000 or total_bytes > 50 * 1024 * 1024 then
    raise exception 'lirismo_quota' using detail = format('%s registros, %s bytes', total_rows, total_bytes);
  end if;
  return null;
end;
$$;

-- Exclusões antigas. Apagar vira uma linha com deleted = true, para os outros
-- aparelhos ficarem sabendo; ela não ocupa espaço, mas conta nos 50 mil
-- registros. Depois de 90 dias ela sai: a cada gravação da conta (acima, sem
-- precisar de nada) e numa varredura diária de todas as contas, se o pg_cron
-- estiver ligado (Database → Extensions → pg_cron; depois, rodar este arquivo
-- de novo). Um aparelho que ficou mais de 60 dias sem sincronizar relê tudo
-- (src/sync/engine.tsx), então não perde exclusão nenhuma. Elas continuam
-- contando no limite enquanto existem: criar e apagar sem parar não enche o banco.
create schema if not exists private;

create index if not exists records_tombstones on records (user_id, updated_at) where deleted;

-- Com uma conta (o trigger), limpa só a dela; sem conta (o pg_cron), todas.
create or replace function private.purge_tombstones(owner uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  gone bigint;
begin
  if auth.uid() is not null then owner := auth.uid(); end if;
  delete from public.records
    where deleted and updated_at < now() - interval '90 days'
      and (owner is null or user_id = owner);
  get diagnostics gone = row_count;
  return gone;
end;
$$;
revoke all on function private.purge_tombstones(uuid) from public, anon;
grant execute on function private.purge_tombstones(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Todo dia às 06:30 UTC, depois do backup das 06:00. Mesmo nome: rodar de novo só atualiza.
    perform cron.schedule('lirismo-limpar-exclusoes', '30 6 * * *', 'select private.purge_tombstones()');
  end if;
end;
$$;

drop trigger if exists records_quota_insert on records;
create trigger records_quota_insert after insert on records
  referencing new table as new_rows
  for each statement execute function records_quota();
drop trigger if exists records_quota_update on records;
create trigger records_quota_update after update on records
  referencing old table as old_rows new table as new_rows
  for each statement execute function records_quota();

-- Capas em imagem: bucket privado, caminho {user_id}/{storyId}.
-- O app reduz cada imagem no navegador antes de enviar (capa do livro em até
-- 400 × 576 px, foto 256 × 256, capa do perfil 960 × 320, sempre JPEG): todas
-- ficam bem abaixo de 1 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
-- ATENÇÃO: o update abaixo só pode rodar DEPOIS que o app que reduz as capas
-- estiver no ar (PR "capas-menores"). Antes disso, quem ainda tem uma capa
-- grande não consegue sincronizar. Baixa o limite de 5 MB para 1 MB.
update storage.buckets set file_size_limit = 1048576 where id = 'covers';

-- No máximo 50 capas por conta (trocar uma capa que já existe passa sempre).
-- Fica num schema que a API não publica; a regra de "enviar" não pode contar
-- storage.objects direto, porque daria recursão infinita nas regras da tabela.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.cover_allowed(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects where bucket_id = 'covers' and name = object_name)
      or (select count(*) from storage.objects
          where bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text) < 50;
$$;
revoke all on function private.cover_allowed(text) from public, anon;
grant execute on function private.cover_allowed(text) to authenticated;

drop policy if exists "capas do dono: ler" on storage.objects;
drop policy if exists "capas do dono: enviar" on storage.objects;
drop policy if exists "capas do dono: trocar" on storage.objects;
drop policy if exists "capas do dono: apagar" on storage.objects;

create policy "capas do dono: ler" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "capas do dono: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text and private.cover_allowed(name));
create policy "capas do dono: trocar" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "capas do dono: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Perfil: o @ de cada pessoa, único sem diferenciar maiúsculas de minúsculas.
-- Mesmas regras do @ do X (Twitter): de 4 a 15 caracteres, só letras sem
-- acento, números e "_", e sem as palavras "lirismo" e "admin". O nome e a
-- foto ficam nos metadados da conta (src/sync/profile.ts).
create table if not exists profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  handle text not null,
  created_at timestamptz not null default now()
);

alter table profiles drop constraint if exists profiles_handle_format;
alter table profiles add constraint profiles_handle_format
  check (handle ~ '^[A-Za-z0-9_]{4,15}$' and lower(handle) !~ '(lirismo|admin)');
create unique index if not exists profiles_handle_unique on profiles (lower(handle));

alter table profiles enable row level security;
revoke all on profiles from anon;
grant select, insert, update, delete on profiles to authenticated;

-- Cada um lê e muda só o próprio @.
drop policy if exists "dono" on profiles;
create policy "dono" on profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- "Este @ está livre?", sem deixar ninguém ler a tabela inteira.
create or replace function public.handle_available(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select candidate ~ '^[A-Za-z0-9_]{4,15}$'
     and lower(candidate) !~ '(lirismo|admin)'
     and not exists (
       select 1 from public.profiles
       where lower(handle) = lower(candidate) and user_id is distinct from (select auth.uid())
     );
$$;
revoke all on function public.handle_available(text) from public, anon;
grant execute on function public.handle_available(text) to authenticated;

-- Faz a API enxergar as tabelas na hora.
notify pgrst, 'reload schema';
