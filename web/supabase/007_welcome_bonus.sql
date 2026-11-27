-- Welcome bonus: the first top-up made within N hours of signing up (email confirmed) gets +P% credits.
-- Settings live in app_settings (promo_welcome_pct = 0 turns it off, promo_welcome_hours = window).
alter table public.payments add column if not exists bonus int not null default 0;

insert into public.app_settings (key, value) values ('promo_welcome_pct', '30'), ('promo_welcome_hours', '24')
  on conflict (key) do nothing;

-- The current user's offer: active only for a confirmed account inside the window that has never paid yet.
create or replace function public.welcome_offer() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_pct int; v_hours int; v_created timestamptz; v_ok boolean; v_ends timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('active', false); end if;
  select coalesce(nullif((select value from public.app_settings where key = 'promo_welcome_pct'), '')::int, 0),
         coalesce(nullif((select value from public.app_settings where key = 'promo_welcome_hours'), '')::int, 24)
    into v_pct, v_hours;
  if v_pct <= 0 then return jsonb_build_object('active', false); end if;
  select created_at, email_confirmed_at is not null into v_created, v_ok from auth.users where id = auth.uid();
  if v_created is null or not v_ok then return jsonb_build_object('active', false); end if;
  v_ends := v_created + make_interval(hours => v_hours);
  if v_ends <= now() then return jsonb_build_object('active', false); end if;
  if exists (select 1 from public.payments where user_id = auth.uid() and status = 'paid') then return jsonb_build_object('active', false); end if;
  return jsonb_build_object('active', true, 'pct', v_pct, 'ends_at', v_ends);
end $$;

create or replace function public.create_topup(p_package text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_pkg public.credit_packages; v_id uuid; v_open int; v_offer jsonb; v_bonus int := 0;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_pkg from public.credit_packages where id = p_package and aktif;
  if not found then raise exception 'package_not_found'; end if;
  select count(*) into v_open from public.payments
    where user_id = v_user and status = 'pending' and created_at > now() - interval '1 hour';
  if v_open >= 5 then raise exception 'too_many_pending'; end if;
  v_offer := public.welcome_offer();
  if (v_offer->>'active')::boolean then v_bonus := round(v_pkg.kredit * (v_offer->>'pct')::int / 100.0)::int; end if;
  insert into public.payments (user_id, package_id, kredit, jumlah, provider, status, bonus)
    values (v_user, v_pkg.id, v_pkg.kredit + v_bonus, v_pkg.harga, 'qris', 'pending', v_bonus) returning id into v_id;
  return jsonb_build_object('id', v_id, 'package', v_pkg.id, 'nama', v_pkg.nama, 'kredit', v_pkg.kredit + v_bonus, 'harga', v_pkg.harga, 'bonus', v_bonus);
end $$;

-- Only the first paid bonus counts, even if several pending top-ups were created inside the window.
create or replace function public.admin_confirm_payment(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.payments; v_bal int; v_grant int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into r from public.payments where id = p_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if r.status = 'paid' then raise exception 'already_paid'; end if;
  v_grant := r.kredit;
  if r.bonus > 0 and exists (select 1 from public.payments where user_id = r.user_id and status = 'paid' and bonus > 0 and id <> r.id) then
    v_grant := r.kredit - r.bonus;
  end if;
  update public.payments set status = 'paid', paid_at = now(), confirmed_by = auth.uid() where id = p_id;
  v_bal := public.grant_credits(r.user_id, v_grant, 'topup_' || r.package_id, 'pay:' || r.id::text);
  return jsonb_build_object('id', r.id, 'status', 'paid', 'user_balance', v_bal);
end $$;

create or replace function public.midtrans_settle(p_id uuid, p_gross numeric, p_txid text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.payments; v_bal int; v_email text; v_pkg text; v_rp text; v_total int; v_grant int;
begin
  select * into r from public.payments where id = p_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if r.status = 'paid' then return jsonb_build_object('status', 'paid', 'already', true); end if;
  if coalesce(r.provider, '') <> 'midtrans' then raise exception 'wrong_provider'; end if;
  v_total := r.jumlah + coalesce(r.biaya, 0);
  v_rp := 'Rp' || replace(to_char(v_total, 'FM999,999,999'), ',', '.');
  if p_gross is null or p_gross <> v_total then
    update public.payments set note = left('Nominal Midtrans ' || coalesce(p_gross::text, '?') || ' tidak sama dengan ' || v_total, 300) where id = p_id;
    perform public.notify_telegram('⚠️ <b>Nominal pembayaran tidak cocok</b>' || chr(10) || 'Kode: <code>' || upper(left(r.id::text, 8)) || '</code> · seharusnya ' || v_rp || ', masuk ' || coalesce(p_gross::text, '?') || '. Cek di dashboard Midtrans.');
    raise exception 'amount_mismatch';
  end if;
  v_grant := r.kredit;
  if r.bonus > 0 and exists (select 1 from public.payments where user_id = r.user_id and status = 'paid' and bonus > 0 and id <> r.id) then
    v_grant := r.kredit - r.bonus;
  end if;
  update public.payments set status = 'paid', paid_at = now(), provider_ref = coalesce(provider_ref, p_txid), note = 'Midtrans otomatis' where id = p_id;
  v_bal := public.grant_credits(r.user_id, v_grant, 'topup_' || r.package_id, 'pay:' || r.id::text);
  select email into v_email from auth.users where id = r.user_id;
  select nama into v_pkg from public.credit_packages where id = r.package_id;
  perform public.notify_telegram('✅ <b>Pembayaran otomatis diterima</b>' || chr(10) ||
    '<b>' || v_rp || '</b>' || case when coalesce(r.biaya, 0) > 0 then ' (termasuk biaya Rp' || replace(to_char(r.biaya, 'FM999,999'), ',', '.') || ')' else '' end ||
    ' · ' || coalesce(v_pkg, r.package_id) || ' (' || v_grant || ' kredit' || case when r.bonus > 0 and v_grant = r.kredit then ', termasuk bonus ' || r.bonus else '' end || ')' || chr(10) ||
    'Akun: ' || replace(replace(replace(coalesce(v_email, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || chr(10) ||
    'Kode: <code>' || upper(left(r.id::text, 8)) || '</code> · kredit sudah masuk.');
  return jsonb_build_object('status', 'paid', 'balance', v_bal);
end $$;

create or replace function public.admin_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_key not in ('qris_static', 'kontak_whatsapp', 'pay_mode', 'promo_welcome_pct', 'promo_welcome_hours') then raise exception 'invalid_key'; end if;
  if p_key = 'pay_mode' and p_value not in ('manual', 'midtrans') then raise exception 'invalid_value'; end if;
  if p_key = 'promo_welcome_pct' and (p_value !~ '^[0-9]{1,3}$' or p_value::int > 100) then raise exception 'invalid_value'; end if;
  if p_key = 'promo_welcome_hours' and (p_value !~ '^[0-9]{1,3}$' or p_value::int < 1 or p_value::int > 168) then raise exception 'invalid_value'; end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function public.welcome_offer() from public, anon;
grant execute on function public.welcome_offer() to authenticated;
