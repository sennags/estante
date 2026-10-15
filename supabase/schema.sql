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
-- tem 500 MB): 20 MB e 50 mil registros. 20 MB dão uns 300 capítulos de 3 mil
-- palavras com as versões; são 25 contas cheias até lotar o banco (com 50 MB,
-- eram 10). Quem passa do limite recebe o erro 'lirismo_quota', e o app avisa
-- que a nuvem da conta está cheia. Apagar e encolher passam sempre, para
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
  if total_rows > 50000 or total_bytes > 20 * 1024 * 1024 then
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

-- Comunidade: as histórias publicadas, que qualquer pessoa lê, mesmo sem
-- conta. Publicar guarda uma cópia do capítulo: mexer no rascunho não muda
-- o que os leitores veem até o autor atualizar (src/sync/community.ts). Só
-- publica quem tem @ (a referência a profiles exige). Para tirar do ar uma
-- história denunciada: delete from publications where id = '<id>';
-- (os capítulos vão junto, e a capa deixa de ser pública).
create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles (user_id) on delete cascade,
  story_id text not null check (length(story_id) <= 64),
  title text not null check (length(title) between 1 and 200),
  synopsis text not null default '' check (length(synopsis) <= 2000),
  -- A mesma lista de src/lib/genres.ts: o filtro da Home depende dela. Para
  -- mudar, trocar nos dois lugares (e aqui com drop/add da constraint).
  genre text not null default '' check (genre in ('', 'Aventura', 'Conto', 'Distopia', 'Drama', 'Fanfic', 'Fantasia', 'Ficção científica',
    'Ficção histórica', 'Humor', 'Infantil', 'Jovem adulto', 'Mistério', 'Não ficção', 'Poesia',
    'Policial', 'Romance', 'Suspense', 'Terror', 'Outro')),
  cover_color text not null default '#2F4A3F' check (cover_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- A capa em imagem é uma cópia em covers/{user_id}/publicada-{story_id}.
  -- Só esse caminho: apontar para outro arquivo o tornaria público.
  cover_path text check (cover_path = user_id::text || '/publicada-' || story_id),
  author_name text not null default '' check (length(author_name) <= 60),
  -- Os dois abaixo só o banco muda (pelo trigger dos capítulos).
  chapter_count int not null default 0,
  last_chapter_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, story_id),
  unique (id, user_id)
);
-- A ordem da Home, com o id para desempatar na paginação (community_feed).
drop index if exists publications_recent;
create index if not exists publications_feed on publications (last_chapter_at desc, id desc) where chapter_count > 0;

create table if not exists published_chapters (
  publication_id uuid not null,
  user_id uuid not null default auth.uid(),
  chapter_id text not null check (length(chapter_id) <= 64),
  position int not null check (position between 1 and 10000),
  title text not null default '' check (length(title) <= 200),
  content jsonb not null check (pg_column_size(content) <= 1024 * 1024),
  word_count int not null default 0 check (word_count >= 0),
  -- O começo do texto, para a Home mostrar sem baixar o capítulo.
  excerpt text not null default '' check (length(excerpt) <= 300),
  -- O updatedAt do capítulo no aparelho quando foi publicado: mais novo no
  -- aparelho = "mudou depois de publicado".
  source_updated_at bigint not null default 0,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (publication_id, chapter_id),
  -- O capítulo é sempre de uma história do mesmo autor.
  foreign key (publication_id, user_id) references publications (id, user_id) on delete cascade
);

alter table publications enable row level security;
alter table published_chapters enable row level security;

-- Ler: todo mundo. Gravar: o autor, e só as colunas que são dele (a data do
-- último capítulo, que ordena a Home, e a contagem ficam com o banco). O
-- upsert da API repete as colunas da chave no update, por isso elas entram.
revoke all on publications, published_chapters from anon, authenticated;
grant select on publications, published_chapters to anon, authenticated;
grant insert (story_id, title, synopsis, genre, cover_color, cover_path, author_name),
  update (story_id, title, synopsis, genre, cover_color, cover_path, author_name),
  delete on publications to authenticated;
grant insert (publication_id, chapter_id, position, title, content, word_count, excerpt, source_updated_at),
  update (publication_id, chapter_id, position, title, content, word_count, excerpt, source_updated_at),
  delete on published_chapters to authenticated;

drop policy if exists "todos: ler" on publications;
drop policy if exists "dono: publicar" on publications;
drop policy if exists "dono: mudar" on publications;
drop policy if exists "dono: tirar" on publications;
create policy "todos: ler" on publications for select to anon, authenticated using (true);
create policy "dono: publicar" on publications for insert to authenticated with check (user_id = (select auth.uid()));
create policy "dono: mudar" on publications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "dono: tirar" on publications for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "todos: ler" on published_chapters;
drop policy if exists "dono: publicar" on published_chapters;
drop policy if exists "dono: mudar" on published_chapters;
drop policy if exists "dono: tirar" on published_chapters;
create policy "todos: ler" on published_chapters for select to anon, authenticated using (true);
create policy "dono: publicar" on published_chapters for insert to authenticated with check (user_id = (select auth.uid()));
create policy "dono: mudar" on published_chapters for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "dono: tirar" on published_chapters for delete to authenticated using (user_id = (select auth.uid()));

-- O @ e a capa de quem publicou ficam visíveis para todos; o resto, não.
grant select on profiles to anon;
drop policy if exists "autores: ler" on profiles;
create policy "autores: ler" on profiles for select to anon, authenticated
  using (exists (select 1 from publications p where p.user_id = profiles.user_id));

drop policy if exists "capas publicadas: ler" on storage.objects;
create policy "capas publicadas: ler" on storage.objects for select to anon, authenticated
  using (bucket_id = 'covers' and exists (select 1 from public.publications p where p.cover_path = name));

-- Capítulo novo sobe a história na Home; a contagem acompanha.
create or replace function private.publication_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pub uuid := coalesce(new.publication_id, old.publication_id);
begin
  update public.publications set
    chapter_count = (select count(*) from public.published_chapters where publication_id = pub),
    last_chapter_at = case when tg_op = 'INSERT' then now() else last_chapter_at end
  where id = pub;
  -- Sem capítulo nenhum, a história sai do ar.
  delete from public.publications where id = pub and chapter_count = 0 and tg_op = 'DELETE';
  return null;
end;
$$;
revoke all on function private.publication_count() from public, anon, authenticated;

drop trigger if exists published_chapters_count on published_chapters;
create trigger published_chapters_count after insert or delete on published_chapters
  for each row execute function private.publication_count();

create or replace function private.published_chapter_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.published_at := old.published_at;
  return new;
end;
$$;
drop trigger if exists published_chapters_touch on published_chapters;
create trigger published_chapters_touch before update on published_chapters
  for each row execute function private.published_chapter_touch();

-- História na lixeira ou apagada, e capítulo apagado, saem do ar. Fica no
-- banco, e não só no app, para valer quando o autor apaga em outro aparelho
-- ou sem internet: chega aqui pela sincronização. Devolver da lixeira não
-- publica de novo.
create or replace function private.unpublish_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'stories' and (new.deleted or new.data->>'deletedAt' is not null) then
    delete from public.publications where user_id = new.user_id and story_id = new.id;
  elsif new.kind = 'chapters' and new.deleted then
    delete from public.published_chapters where user_id = new.user_id and chapter_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function private.unpublish_removed() from public, anon, authenticated;

drop trigger if exists records_unpublish on records;
create trigger records_unpublish after insert or update on records
  for each row when (new.kind in ('stories', 'chapters'))
  execute function private.unpublish_removed();

-- O que já tinha sido apagado antes deste trigger existir também sai do ar.
-- Rodar de novo não muda nada.
delete from publications p using records r
  where r.user_id = p.user_id and r.kind = 'stories' and r.id = p.story_id
    and (r.deleted or r.data->>'deletedAt' is not null);
delete from published_chapters c using records r
  where r.user_id = c.user_id and r.kind = 'chapters' and r.id = c.chapter_id and r.deleted;

-- A Home: uma página de histórias, cada uma já resumida, sem baixar a lista
-- de capítulos. `progress` é o que o leitor leu ({ "<id da publicação>":
-- posição do último capítulo aberto }, guardado só no aparelho dele). A
-- página seguinte começa depois de (before_at, before_id), a última linha da
-- anterior. Roda com as regras de quem chama: lê só o que já é público.
create index if not exists published_chapters_position on published_chapters (publication_id, position);

drop function if exists public.community_feed(text, timestamptz, uuid, jsonb, int);
create function public.community_feed(
  genre_filter text default null,
  before_at timestamptz default null,
  before_id uuid default null,
  progress jsonb default '{}'::jsonb,
  page_size int default 20
) returns table (
  id uuid, title text, synopsis text, genre text, cover_color text, cover_path text, author_name text,
  chapter_count int, last_chapter_at timestamptz, created_at timestamptz, handle text,
  fresh_count int,          -- capítulos publicados nos últimos 7 dias
  latest_position int,      -- o mais novo deles
  read_count int,           -- capítulos até a posição lida
  next_chapter_id text, next_position int, next_word_count int, next_excerpt text,  -- o próximo a ler
  last_chapter_id text      -- para "Reler o último"
)
language sql stable set search_path = '' as $$
  select p.id, p.title, p.synopsis, p.genre, p.cover_color, p.cover_path, p.author_name,
    p.chapter_count, p.last_chapter_at, p.created_at, pr.handle,
    f.fresh_count, f.latest_position, r.read_count,
    n.chapter_id, n.position, n.word_count, n.excerpt,
    l.chapter_id
  from public.publications p
  left join public.profiles pr on pr.user_id = p.user_id
  cross join lateral (
    select case when progress ->> p.id::text ~ '^[0-9]{1,5}$' then (progress ->> p.id::text)::int else 0 end as pos
  ) rp
  cross join lateral (
    select count(*)::int as fresh_count, max(c.position) as latest_position
    from public.published_chapters c
    where c.publication_id = p.id and c.published_at > now() - interval '7 days'
  ) f
  cross join lateral (
    select count(*)::int as read_count from public.published_chapters c
    where c.publication_id = p.id and c.position <= rp.pos
  ) r
  left join lateral (
    select c.chapter_id, c.position, c.word_count, c.excerpt from public.published_chapters c
    where c.publication_id = p.id and c.position > rp.pos
    order by c.position limit 1
  ) n on true
  left join lateral (
    select c.chapter_id from public.published_chapters c
    where c.publication_id = p.id order by c.position desc limit 1
  ) l on true
  where p.chapter_count > 0
    and (genre_filter is null or p.genre = genre_filter)
    and (before_at is null or (p.last_chapter_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by p.last_chapter_at desc, p.id desc
  limit least(greatest(coalesce(page_size, 20), 1), 50);
$$;
revoke all on function public.community_feed(text, timestamptz, uuid, jsonb, int) from public;
grant execute on function public.community_feed(text, timestamptz, uuid, jsonb, int) to anon, authenticated;

-- Limites por conta, à parte dos 20 MB da sincronização: 20 histórias
-- publicadas e 300 capítulos, com 5 MB de texto (uns 150 capítulos de 3 mil
-- palavras). Quem passa recebe 'lirismo_pub_quota'. Tirar do ar e encolher
-- passam sempre.
create or replace function private.publications_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return null; end if;
  if (select count(*) from public.publications where user_id = auth.uid()) > 20 then
    raise exception 'lirismo_pub_quota' using detail = 'histórias';
  end if;
  return null;
end;
$$;
revoke all on function private.publications_quota() from public, anon, authenticated;

drop trigger if exists publications_quota on publications;
create trigger publications_quota after insert on publications
  for each statement execute function private.publications_quota();

create or replace function private.published_chapters_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  added_rows bigint := 0;
  added_bytes bigint;
  total_rows bigint;
  total_bytes bigint;
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'INSERT' then
    select count(*), coalesce(sum(pg_column_size(content)), 0) into added_rows, added_bytes from new_rows;
  else
    select coalesce(sum(pg_column_size(content)), 0) into added_bytes from new_rows;
    added_bytes := added_bytes - (select coalesce(sum(pg_column_size(content)), 0) from old_rows);
  end if;
  if added_rows = 0 and added_bytes <= 0 then return null; end if;
  select count(*), coalesce(sum(pg_column_size(content)), 0) into total_rows, total_bytes
    from public.published_chapters where user_id = auth.uid();
  if total_rows > 300 or total_bytes > 5 * 1024 * 1024 then
    raise exception 'lirismo_pub_quota' using detail = format('%s capítulos, %s bytes', total_rows, total_bytes);
  end if;
  return null;
end;
$$;
revoke all on function private.published_chapters_quota() from public, anon, authenticated;

drop trigger if exists published_chapters_quota_insert on published_chapters;
create trigger published_chapters_quota_insert after insert on published_chapters
  referencing new table as new_rows
  for each statement execute function private.published_chapters_quota();
drop trigger if exists published_chapters_quota_update on published_chapters;
create trigger published_chapters_quota_update after update on published_chapters
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.published_chapters_quota();

-- Faz a API enxergar as tabelas na hora.
notify pgrst, 'reload schema';
