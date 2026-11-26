-- 003_qris_admin: QRIS top-up records + admin tools. Builds on the live schema
-- (credit_ledger, credit_packages, payments, grant_credits, spend_credits, my_role).

-- payment records: buyer marks "sudah bayar", admin confirms → credits granted once
alter table public.payments add column if not exists claimed_at timestamptz;
alter table public.payments add column if not exists note text;
alter table public.payments add column if not exists confirmed_by uuid references auth.users(id) on delete set null;
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);

-- public site settings (QRIS payload is printed on the merchant sticker, not secret)
create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z_]+$'),
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);
grant select on public.app_settings to anon, authenticated;
insert into public.app_settings (key, value) values
  ('qris_static', '00020101021126610014COM.GO-JEK.WWW01189360091436811269360210G6811269360303UMI51440014ID.CO.QRIS.WWW0215ID10264964273150303UMI5204739353033605802ID5925bnwlabstudio, Jasa Keaman6013TEBING TINGGI61052063162070703A0163041323')
on conflict (key) do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select user_role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- buyer: open a top-up for a package (returns what the QR must charge)
create or replace function public.create_topup(p_package text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_pkg public.credit_packages; v_id uuid; v_open int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_pkg from public.credit_packages where id = p_package and aktif;
  if not found then raise exception 'package_not_found'; end if;
  select count(*) into v_open from public.payments
    where user_id = v_user and status = 'pending' and created_at > now() - interval '1 hour';
  if v_open >= 5 then raise exception 'too_many_pending'; end if;
  insert into public.payments (user_id, package_id, kredit, jumlah, provider, status)
    values (v_user, v_pkg.id, v_pkg.kredit, v_pkg.harga, 'qris', 'pending') returning id into v_id;
  return jsonb_build_object('id', v_id, 'package', v_pkg.id, 'nama', v_pkg.nama, 'kredit', v_pkg.kredit, 'harga', v_pkg.harga);
end $$;

-- buyer: "Saya sudah bayar"
create or replace function public.claim_topup(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r public.payments;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.payments set claimed_at = coalesce(claimed_at, now())
    where id = p_id and user_id = auth.uid() and status = 'pending' returning * into r;
  if not found then raise exception 'payment_not_found'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'claimed_at', r.claimed_at);
end $$;

-- buyer: cancel an unpaid top-up
create or replace function public.cancel_topup(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.payments set status = 'expired'
    where id = p_id and user_id = auth.uid() and status = 'pending' and claimed_at is null;
end $$;

-- admin: confirm → credits granted exactly once (ledger ref pay:<id>)
create or replace function public.admin_confirm_payment(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r public.payments; v_bal int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into r from public.payments where id = p_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if r.status = 'paid' then raise exception 'already_paid'; end if;
  update public.payments set status = 'paid', paid_at = now(), confirmed_by = auth.uid() where id = p_id;
  v_bal := public.grant_credits(r.user_id, r.kredit, 'topup_' || r.package_id, 'pay:' || r.id::text);
  return jsonb_build_object('id', r.id, 'status', 'paid', 'user_balance', v_bal);
end $$;

create or replace function public.admin_reject_payment(p_id uuid, p_note text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.payments set status = 'failed', note = left(p_note, 300), confirmed_by = auth.uid()
    where id = p_id and status = 'pending';
  if not found then raise exception 'payment_not_pending'; end if;
end $$;

-- admin: payments with buyer name + email
create or replace function public.admin_list_payments(p_status text default null, p_limit int default 200)
returns table (id uuid, user_id uuid, username text, email text, package_id text, kredit int, jumlah int,
               provider text, status text, claimed_at timestamptz, paid_at timestamptz, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select p.id, p.user_id, pr.username, u.email::text, p.package_id, p.kredit, p.jumlah, p.provider, p.status,
           p.claimed_at, p.paid_at, p.note, p.created_at
    from public.payments p
    left join public.profiles pr on pr.id = p.user_id
    left join auth.users u on u.id = p.user_id
    where p_status is null or p.status = p_status
    order by (p.status = 'pending' and p.claimed_at is not null) desc, (p.status = 'pending') desc, p.created_at desc
    limit least(greatest(p_limit, 1), 1000);
end $$;

-- admin: users with balance
create or replace function public.admin_list_users(p_search text default null, p_limit int default 200)
returns table (id uuid, username text, email text, user_role text, wilayah_id text, credits int,
               created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select pr.id, pr.username, u.email::text, pr.user_role, pr.wilayah_id,
           coalesce((select sum(l.delta) from public.credit_ledger l where l.user_id = pr.id), 0)::int,
           pr.created_at, u.last_sign_in_at
    from public.profiles pr left join auth.users u on u.id = pr.id
    where p_search is null or p_search = ''
       or pr.username ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%'
    order by pr.created_at desc
    limit least(greatest(p_limit, 1), 1000);
end $$;

-- admin: add (or remove) credits by hand, e.g. bank transfer or WhatsApp sale
create or replace function public.admin_adjust_credits(p_user uuid, p_amount int, p_note text default null) returns int
language plpgsql volatile security definer set search_path = public as $$
declare v_ref text := 'admin:' || gen_random_uuid()::text; v_reason text := 'admin_' || coalesce(nullif(left(regexp_replace(coalesce(p_note, ''), '[^A-Za-z0-9 _-]', '', 'g'), 60), ''), 'manual');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then raise exception 'invalid_amount'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user_not_found'; end if;
  if p_amount > 0 then return public.grant_credits(p_user, p_amount, v_reason, v_ref);
  else return public.spend_credits(p_user, -p_amount, v_reason, v_ref); end if;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('user', 'supervisor', 'admin') then raise exception 'invalid_role'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
  update public.profiles set user_role = p_role where id = p_user;
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'users_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'waiting', (select count(*) from public.payments where status = 'pending' and claimed_at is not null),
    'pending', (select count(*) from public.payments where status = 'pending'),
    'revenue_month', (select coalesce(sum(jumlah), 0) from public.payments where status = 'paid'
                       and paid_at >= date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'),
    'revenue_total', (select coalesce(sum(jumlah), 0) from public.payments where status = 'paid'),
    'downloads_month', (select count(*) from public.halftone_image_history
                         where created_at >= date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'));
end $$;

create or replace function public.admin_set_setting(p_key text, p_value text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_key not in ('qris_static', 'kontak_whatsapp') then raise exception 'invalid_key'; end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

do $$ declare f text; begin
  foreach f in array array['is_admin()','create_topup(text)','claim_topup(uuid)','cancel_topup(uuid)',
    'admin_confirm_payment(uuid)','admin_reject_payment(uuid,text)','admin_list_payments(text,integer)',
    'admin_list_users(text,integer)','admin_adjust_credits(uuid,integer,text)','admin_set_role(uuid,text)',
    'admin_stats()','admin_set_setting(text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
