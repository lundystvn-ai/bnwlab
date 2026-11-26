-- 005_support: support tickets (user writes, admin replies; both sides see the thread status)
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  username text,
  topik text not null default 'lainnya' check (topik in ('pembayaran','upscale','editor','akun','lainnya')),
  pesan text not null check (length(btrim(pesan)) between 5 and 2000),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9+ -]{8,20}$'),
  status text not null default 'baru' check (status in ('baru','diproses','selesai')),
  balasan text check (balasan is null or length(balasan) <= 2000),
  dibalas_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, created_at desc);

alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon;
grant select, insert, update on public.support_tickets to authenticated;

drop policy if exists support_read on public.support_tickets;
create policy support_read on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or my_role() = 'admin');
drop policy if exists support_insert_own on public.support_tickets;
create policy support_insert_own on public.support_tickets for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists support_update_admin on public.support_tickets;
create policy support_update_admin on public.support_tickets for update to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- On insert: take email/username from the account (not from the browser), force a fresh ticket,
-- and limit spam to 5 tickets per user per 24 hours.
create or replace function public.support_ticket_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.support_tickets where user_id = new.user_id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too_many_tickets';
  end if;
  new.email := (select email from auth.users where id = new.user_id);
  new.username := (select username from public.profiles where id = new.user_id);
  new.status := 'baru'; new.balasan := null; new.dibalas_at := null;
  new.created_at := now(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists support_ticket_before_insert on public.support_tickets;
create trigger support_ticket_before_insert before insert on public.support_tickets
  for each row execute function public.support_ticket_before_insert();

-- On update (admin only by RLS): only status and reply may change.
create or replace function public.support_ticket_before_update() returns trigger
language plpgsql as $$
begin
  new.user_id := old.user_id; new.email := old.email; new.username := old.username;
  new.topik := old.topik; new.pesan := old.pesan; new.whatsapp := old.whatsapp; new.created_at := old.created_at;
  if new.balasan is distinct from old.balasan then new.dibalas_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists support_ticket_before_update on public.support_tickets;
create trigger support_ticket_before_update before update on public.support_tickets
  for each row execute function public.support_ticket_before_update();
revoke all on function public.support_ticket_before_insert() from public, anon, authenticated;
revoke all on function public.support_ticket_before_update() from public, anon, authenticated;
