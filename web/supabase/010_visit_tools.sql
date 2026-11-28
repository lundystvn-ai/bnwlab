-- Admin → Pengunjung: adds 'tools', the last 7 days of visits for every tool page (always all six, zero included).
create or replace function public.admin_visit_stats(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  d int := greatest(1, least(coalesce(p_days, 30), 365));
  tz text := 'Asia/Jakarta';
  today date := (now() at time zone tz)::date;
  t_from date := today - (d - 1);
  p_from date := t_from - d;
  today_ts timestamptz := today::timestamp at time zone tz;
  t_from_ts timestamptz := t_from::timestamp at time zone tz;
  p_from_ts timestamptz := p_from::timestamp at time zone tz;
  raw_from timestamptz := (today - 6)::timestamp at time zone tz;
  res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  perform public.rollup_site_visits();
  with live as (select today as day, count(distinct visitor)::int visitors, count(distinct session)::int sessions, count(*)::int pageviews
                from public.site_visits where created_at >= today_ts),
  days as (select day, visitors, sessions, pageviews from public.site_visits_daily where day >= p_from and day < today
           union all select * from live),
  cur as (select * from days where day >= t_from),
  prev as (select * from days where day >= p_from and day < t_from),
  raw as (select * from public.site_visits where created_at >= raw_from),
  firsts as (select distinct on (session) session, referrer, utm from raw order by session, id)
  select jsonb_build_object(
    'days', d,
    'summary', jsonb_build_object(
      'visitors', (select coalesce(sum(visitors), 0) from cur),
      'sessions', (select coalesce(sum(sessions), 0) from cur),
      'pageviews', (select coalesce(sum(pageviews), 0) from cur),
      'signups', (select count(*) from auth.users u where u.created_at >= t_from_ts),
      'paid', (select count(*) from public.payments p where p.status = 'paid' and p.paid_at >= t_from_ts),
      'revenue', (select coalesce(sum(p.jumlah), 0) from public.payments p where p.status = 'paid' and p.paid_at >= t_from_ts)),
    'previous', jsonb_build_object(
      'visitors', (select coalesce(sum(visitors), 0) from prev),
      'sessions', (select coalesce(sum(sessions), 0) from prev),
      'pageviews', (select coalesce(sum(pageviews), 0) from prev),
      'signups', (select count(*) from auth.users u where u.created_at >= p_from_ts and u.created_at < t_from_ts),
      'paid', (select count(*) from public.payments p where p.status = 'paid' and p.paid_at >= p_from_ts and p.paid_at < t_from_ts),
      'revenue', (select coalesce(sum(p.jumlah), 0) from public.payments p where p.status = 'paid' and p.paid_at >= p_from_ts and p.paid_at < t_from_ts)),
    'today', (select visitors from live),
    'online', (select count(distinct visitor) from public.site_visits where created_at > now() - interval '5 minutes'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dy, 'visitors', coalesce(c.visitors, 0), 'pageviews', coalesce(c.pageviews, 0)) order by g.dy), '[]'::jsonb)
      from (select gs::date as dy from generate_series(t_from, today, interval '1 day') gs) g left join cur c on c.day = g.dy),
    'pages', (select coalesce(jsonb_agg(r order by r.pageviews desc), '[]'::jsonb) from
      (select x.path as name, count(*) as pageviews, count(distinct x.visitor) as visitors from raw x group by x.path order by 2 desc limit 10) r),
    'tools', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'pageviews', coalesce(c.pageviews, 0), 'visitors', coalesce(c.visitors, 0)) order by t.ord), '[]'::jsonb)
      from unnest(array['cek', 'editor', 'vektor', 'gangsheet', 'upscale', 'ai']) with ordinality as t(name, ord)
      left join (select x.path, count(*) as pageviews, count(distinct x.visitor) as visitors from raw x group by x.path) c on c.path = t.name),
    'sources', (select coalesce(jsonb_agg(r order by r.sessions desc), '[]'::jsonb) from
      (select coalesce(f.utm, f.referrer, '') as name, count(*) as sessions from firsts f group by 1 order by 2 desc limit 10) r),
    'devices', (select coalesce(jsonb_agg(r order by r.visitors desc), '[]'::jsonb) from
      (select x.device as name, count(distinct x.visitor) as visitors from raw x group by x.device) r),
    'langs', (select coalesce(jsonb_agg(r order by r.visitors desc), '[]'::jsonb) from
      (select coalesce(x.lang, '?') as name, count(distinct x.visitor) as visitors from raw x group by 1) r)
  ) into res;
  return res;
end $function$;
