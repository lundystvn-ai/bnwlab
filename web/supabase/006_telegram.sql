-- 006_telegram: tell the admin on Telegram when a buyer presses "Saya sudah bayar".
-- The bot token and chat id live in app_secrets (service role only); the edge function telegram-admin sets them.
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_telegram(p_text text, p_button_text text default null, p_button_url text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_token text; v_chat text; v_body jsonb;
begin
  select value into v_token from public.app_secrets where key = 'telegram_bot_token';
  select value into v_chat from public.app_secrets where key = 'telegram_chat_id';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then return; end if;
  v_body := jsonb_build_object('chat_id', v_chat, 'text', p_text, 'parse_mode', 'HTML', 'disable_web_page_preview', true);
  if p_button_url is not null then
    v_body := v_body || jsonb_build_object('reply_markup', jsonb_build_object('inline_keyboard',
      jsonb_build_array(jsonb_build_array(jsonb_build_object('text', coalesce(p_button_text, 'Buka'), 'url', p_button_url)))));
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := v_body,
    headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then
  -- a notification must never block the buyer's payment claim
  raise warning 'notify_telegram failed: %', sqlerrm;
end $$;
revoke all on function public.notify_telegram(text, text, text) from public, anon, authenticated;

create or replace function public.payments_notify_claim() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_user text; v_pkg text; v_rp text;
begin
  if old.claimed_at is null and new.claimed_at is not null and new.status = 'pending' then
    select email into v_email from auth.users where id = new.user_id;
    select username into v_user from public.profiles where id = new.user_id;
    select nama into v_pkg from public.credit_packages where id = new.package_id;
    v_rp := 'Rp' || replace(to_char(new.jumlah, 'FM999,999,999'), ',', '.');
    perform public.notify_telegram(
      '💰 <b>Pembayaran menunggu konfirmasi</b>' || chr(10) ||
      '<b>' || v_rp || '</b> · ' || coalesce(v_pkg, new.package_id) || ' (' || new.kredit || ' kredit)' || chr(10) ||
      'Akun: ' || replace(replace(replace(coalesce(v_email, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') ||
        coalesce(' (' || replace(replace(replace(v_user, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ')', '') || chr(10) ||
      'Kode: <code>' || upper(left(new.id::text, 8)) || '</code>' || chr(10) ||
      'Cek uang masuk ' || v_rp || ' di GoPay Merchant, lalu konfirmasi.',
      'Buka menu Pembayaran', 'https://bnwlab.com/#admin/pembayaran');
  end if;
  return new;
end $$;
revoke all on function public.payments_notify_claim() from public, anon, authenticated;
drop trigger if exists payments_notify_claim on public.payments;
create trigger payments_notify_claim after update of claimed_at on public.payments
  for each row execute function public.payments_notify_claim();
