-- Usage monitor for Admin → Ringkasan/Redraw AI: how close the Free plan's monthly data transfer (egress) is.
-- Redraw AI results are the only large responses the site sends, so each one's size is logged here (service role only).
create table if not exists public.ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  bytes bigint not null check (bytes >= 0),
  size text
);
create index if not exists ai_usage_created_at on public.ai_usage (created_at);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

-- Quota in GB (default 5 = Supabase Free). Change it after upgrading: update app_secrets set value = '250' where key = 'usage_egress_quota_gb'.
insert into public.app_secrets (key, value) values ('usage_egress_quota_gb', '5') on conflict (key) do nothing;

-- Estimated transfer over the last 30 days: logged AI results + ~40 KB of API data per page view.
create or replace function public.usage_estimate()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quota bigint := coalesce(nullif((select value from public.app_secrets where key = 'usage_egress_quota_gb'), '')::numeric, 5) * 1000000000;
  v_ai30 bigint; v_n30 int; v_ai7 bigint; v_n7 int; v_pv bigint; v_other bigint; v_first timestamptz;
  v_avg2 bigint; v_avg4 bigint;
begin
  select coalesce(sum(bytes), 0), count(*) into v_ai30, v_n30 from public.ai_usage where created_at > now() - interval '30 days';
  select coalesce(sum(bytes), 0), count(*) into v_ai7, v_n7 from public.ai_usage where created_at > now() - interval '7 days';
  select min(created_at) into v_first from public.ai_usage;
  select avg(bytes)::bigint into v_avg2 from public.ai_usage where size = '2K' and created_at > now() - interval '30 days';
  select avg(bytes)::bigint into v_avg4 from public.ai_usage where size = '4K' and created_at > now() - interval '30 days';
  select coalesce((select sum(pageviews) from public.site_visits_daily where day > (now() at time zone 'Asia/Jakarta')::date - 30
                    and day < (now() at time zone 'Asia/Jakarta')::date), 0)
       + (select count(*) from public.site_visits where created_at >= ((now() at time zone 'Asia/Jakarta')::date)::timestamp at time zone 'Asia/Jakarta')
    into v_pv;
  v_other := v_pv * 40000;
  return jsonb_build_object(
    'quota', v_quota, 'ai_bytes', v_ai30, 'ai_count', v_n30, 'other_bytes', v_other, 'pageviews', v_pv,
    'total', v_ai30 + v_other,
    'week_ai_bytes', v_ai7, 'week_ai_count', v_n7,
    -- pace of the last 7 days stretched to 30 days
    'projected', ((v_ai7 * 30) / 7) + v_other,
    'avg_2k', v_avg2, 'avg_4k', v_avg4, 'since', v_first);
end $$;
revoke all on function public.usage_estimate() from public, anon, authenticated;
grant execute on function public.usage_estimate() to service_role;

create or replace function public.admin_usage_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return public.usage_estimate();
end $$;
revoke all on function public.admin_usage_stats() from public, anon;
grant execute on function public.admin_usage_stats() to authenticated;

-- Called by ai-redraw after each delivered image. Sends one Telegram alert per level (50%, 80%, 95%) within 30 days.
create or replace function public.ai_log_usage(p_bytes bigint, p_size text)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb; v_pct numeric; v_level int; v_prev text; v_prev_level int := 0; v_prev_at timestamptz;
begin
  insert into public.ai_usage (bytes, size) values (greatest(0, coalesce(p_bytes, 0)), left(coalesce(p_size, ''), 4));
  delete from public.ai_usage where created_at < now() - interval '120 days';
  v := public.usage_estimate();
  v_pct := greatest((v->>'total')::numeric, (v->>'projected')::numeric) * 100 / nullif((v->>'quota')::numeric, 0);
  v_level := case when v_pct >= 95 then 95 when v_pct >= 80 then 80 when v_pct >= 50 then 50 else 0 end;
  if v_level = 0 then return; end if;
  select value into v_prev from public.app_secrets where key = 'usage_alert';
  if v_prev ~ '^\d+\|' then
    v_prev_level := split_part(v_prev, '|', 1)::int;
    begin v_prev_at := split_part(v_prev, '|', 2)::timestamptz; exception when others then v_prev_at := null; end;
  end if;
  if v_prev_level >= v_level and v_prev_at > now() - interval '30 days' then return; end if;
  insert into public.app_secrets (key, value, updated_at) values ('usage_alert', v_level || '|' || now()::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.notify_telegram(
    format(E'⚠️ <b>Kuota transfer data %s%%</b>\nPerkiraan 30 hari: %s GB dari %s GB (laju 7 hari terakhir: %s GB/bulan).\nRedraw AI 30 hari: %s gambar.\n%s',
      round(v_pct), round((v->>'total')::numeric / 1e9, 2), round((v->>'quota')::numeric / 1e9), round((v->>'projected')::numeric / 1e9, 2),
      v->>'ai_count',
      case when v_level >= 80 then 'Saatnya upgrade Supabase ke Pro. Panduan ada di Admin → Ringkasan.' else 'Siapkan rencana upgrade Supabase Pro.' end),
    'Buka Admin', 'https://bnwlab.com/#admin');
end $$;
revoke all on function public.ai_log_usage(bigint, text) from public, anon, authenticated;
grant execute on function public.ai_log_usage(bigint, text) to service_role;

-- Admin sets the plan's transfer quota after upgrading (5 = Free, 250 = Pro).
create or replace function public.admin_set_usage_quota(p_gb int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_gb is null or p_gb < 1 or p_gb > 100000 then raise exception 'invalid'; end if;
  insert into public.app_secrets (key, value, updated_at) values ('usage_egress_quota_gb', p_gb::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  delete from public.app_secrets where key = 'usage_alert';
end $$;
revoke all on function public.admin_set_usage_quota(int) from public, anon;
grant execute on function public.admin_set_usage_quota(int) to authenticated;
