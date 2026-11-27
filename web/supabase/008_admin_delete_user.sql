-- 008_admin_delete_user: admin can delete an account (e.g. to re-test the welcome-bonus timer).
-- Everything tied to the user cascades (payments, ledger, history, tickets), so payments are archived first.
create table if not exists public.deleted_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  email text,
  username text,
  credits int,
  paid_total int not null default 0,
  payments jsonb not null default '[]',
  created_at_user timestamptz,
  deleted_at timestamptz not null default now(),
  deleted_by uuid
);
alter table public.deleted_accounts enable row level security;   -- no policies: only security-definer functions touch it

create or replace function public.admin_delete_user(p_user uuid, p_force boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_role text; v_email text; v_name text; v_created timestamptz; v_bal int;
  v_paid int; v_pay jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_delete_self'; end if;
  select user_role, username into v_role, v_name from public.profiles where id = p_user;
  select email::text, created_at into v_email, v_created from auth.users where id = p_user;
  if v_email is null and v_role is null then raise exception 'user_not_found'; end if;
  if v_role = 'admin' then raise exception 'cannot_delete_admin'; end if;
  select coalesce(sum(jumlah), 0), coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    into v_paid, v_pay from public.payments p where p.user_id = p_user and p.status = 'paid';
  if v_paid > 0 and not p_force then raise exception 'has_paid_payments:%', v_paid; end if;
  select coalesce(sum(delta), 0) into v_bal from public.credit_ledger where user_id = p_user;
  insert into public.deleted_accounts (user_id, email, username, credits, paid_total, payments, created_at_user, deleted_by)
    values (p_user, v_email, v_name, v_bal, v_paid, v_pay, v_created, auth.uid());
  delete from auth.users where id = p_user;
  return jsonb_build_object('deleted', p_user, 'email', v_email, 'paid_total', v_paid);
end $$;
revoke all on function public.admin_delete_user(uuid, boolean) from public, anon;
grant execute on function public.admin_delete_user(uuid, boolean) to authenticated;
