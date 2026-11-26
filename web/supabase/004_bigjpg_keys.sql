-- 004_bigjpg_keys: several paid BigJPG accounts used in turn (each with its own monthly quota).
create table if not exists public.bigjpg_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Akun BigJPG',
  api_key text not null unique,
  monthly_quota integer not null default 2000 check (monthly_quota > 0),
  active boolean not null default true,
  exhausted_month text,                 -- 'YYYY-MM' (Asia/Jakarta) when BigJPG answered month_limit
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- service role only (the edge function); keys never reach the browser
alter table public.bigjpg_keys enable row level security;
revoke all on public.bigjpg_keys from anon, authenticated;

-- which account processed each upscale (status checks must use the same key)
alter table public.riwayat_bigjpg add column if not exists key_id uuid references public.bigjpg_keys(id) on delete set null;
create index if not exists riwayat_bigjpg_key_month_idx on public.riwayat_bigjpg (key_id, created_at);

-- move the existing single key into the pool (kept in app_secrets too, as a fallback)
insert into public.bigjpg_keys (label, api_key, sort)
select 'Akun 1', value, 0 from public.app_secrets where key = 'bigjpg_api_key' and length(value) >= 8
on conflict (api_key) do nothing;

-- everything before this ran on that single key: count it against Akun 1
update public.riwayat_bigjpg set key_id = (select id from public.bigjpg_keys where label = 'Akun 1' order by created_at limit 1)
where key_id is null and bigjpg_tid is not null;
