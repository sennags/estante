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
  return new;
end;
$$;

drop trigger if exists records_rev on records;
create trigger records_rev before insert or update on records
  for each row execute function records_next_rev();

-- Capas em imagem: bucket privado, caminho {user_id}/{storyId}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "capas do dono: ler" on storage.objects;
drop policy if exists "capas do dono: enviar" on storage.objects;
drop policy if exists "capas do dono: trocar" on storage.objects;
drop policy if exists "capas do dono: apagar" on storage.objects;

create policy "capas do dono: ler" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "capas do dono: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "capas do dono: trocar" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "capas do dono: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Faz a API enxergar a tabela na hora.
notify pgrst, 'reload schema';
