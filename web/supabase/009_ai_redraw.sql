-- Gambar ulang AI: credits are taken before the AI runs and given back if it fails.
-- New image: ref 'ai:<id>'. Revision: ref 'air:<parent>:<id>' (max 3 per image, within 60 minutes).
-- Called only by the ai-redraw Edge Function (service role).
create or replace function public.ai_charge(p_user uuid, p_id text, p_cost int, p_parent text default null, p_hourly_limit int default 40)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare v_balance int; v_ref text;
begin
  if p_id !~ '^[0-9a-f-]{36}$' or (p_parent is not null and p_parent !~ '^[0-9a-f-]{36}$')
     or p_cost is null or p_cost <= 0 or p_cost > 100 then raise exception 'invalid'; end if;
  v_ref := case when p_parent is null then 'ai:' || p_id else 'air:' || p_parent || ':' || p_id end;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  if exists (select 1 from public.credit_ledger where ref = v_ref) then raise exception 'duplicate'; end if;   -- same request twice: no second AI run
  -- per hour: at most p_hourly_limit runs, and a pause after 6 failed (refunded) runs
  if (select count(*) from public.credit_ledger where user_id = p_user and reason in ('ai_redraw', 'ai_revise') and created_at > now() - interval '1 hour') >= p_hourly_limit
     or (select count(*) from public.credit_ledger where user_id = p_user and reason = 'ai_refund' and ref like 'aif:%' and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'rate_limited';
  end if;
  if p_parent is not null then
    if not exists (select 1 from public.credit_ledger where user_id = p_user and ref = 'ai:' || p_parent and created_at > now() - interval '60 minutes') then
      raise exception 'revision_expired';
    end if;
    if (select count(*) from public.credit_ledger l where l.user_id = p_user and l.ref like 'air:' || p_parent || ':%' and l.delta < 0
          and not exists (select 1 from public.credit_ledger f where f.ref = 'aif:' || l.ref)) >= 3 then
      raise exception 'revision_limit';
    end if;
  end if;
  select coalesce(sum(delta), 0)::int into v_balance from public.credit_ledger where user_id = p_user;
  if v_balance < p_cost then raise exception 'insufficient_credits'; end if;
  insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user, -p_cost, case when p_parent is null then 'ai_redraw' else 'ai_revise' end, v_ref);
  return v_balance - p_cost;
end $function$;

create or replace function public.ai_refund(p_user uuid, p_ref text)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare v_delta int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select delta into v_delta from public.credit_ledger where user_id = p_user and ref = p_ref and delta < 0 and reason in ('ai_redraw', 'ai_revise');
  if v_delta is not null and not exists (select 1 from public.credit_ledger where ref = 'aif:' || p_ref) then
    insert into public.credit_ledger (user_id, delta, reason, ref) values (p_user, -v_delta, 'ai_refund', 'aif:' || p_ref);
  end if;
  return (select coalesce(sum(delta), 0)::int from public.credit_ledger where user_id = p_user);
end $function$;

revoke all on function public.ai_charge(uuid, text, int, text, int) from public, anon, authenticated;
revoke all on function public.ai_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_charge(uuid, text, int, text, int) to service_role;
grant execute on function public.ai_refund(uuid, text) to service_role;
