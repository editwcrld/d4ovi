-- The website's saved builds: one row per device code.
-- Run once in Supabase → SQL Editor.
--
-- No login: the code (a random UUID the page keeps) is the only key. The table is closed to the
-- publishable key; only the two functions below reach it, and each one only for the code it is
-- given – nobody can list the other codes.

create table if not exists public.web_builds (
  owner uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.web_builds enable row level security;
revoke all on public.web_builds from anon, authenticated;

create or replace function public.get_builds(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select data from public.web_builds where owner = p_owner
$$;

create or replace function public.save_builds(p_owner uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if octet_length(p_data::text) > 1000000 then
    raise exception 'builds too large';
  end if;
  insert into public.web_builds (owner, data, updated_at) values (p_owner, p_data, now())
  on conflict (owner) do update set data = excluded.data, updated_at = now();
end
$$;

revoke all on function public.get_builds(uuid) from public;
revoke all on function public.save_builds(uuid, jsonb) from public;
grant execute on function public.get_builds(uuid) to anon;
grant execute on function public.save_builds(uuid, jsonb) to anon;
