-- Admin → Pengguna: also return email_confirmed_at, so unconfirmed sign-ups get a label and a "send again" button.
drop function if exists public.admin_list_users(text, integer);
create function public.admin_list_users(p_search text default null, p_limit integer default 200)
returns table(id uuid, username text, email text, user_role text, wilayah_id text, credits integer,
              created_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select pr.id, pr.username, u.email::text, pr.user_role, pr.wilayah_id,
           coalesce((select sum(l.delta) from public.credit_ledger l where l.user_id = pr.id), 0)::int,
           pr.created_at, u.last_sign_in_at, u.email_confirmed_at
    from public.profiles pr left join auth.users u on u.id = pr.id
    where p_search is null or p_search = ''
       or pr.username ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%'
    order by pr.created_at desc
    limit least(greatest(p_limit, 1), 1000);
end $function$;
revoke all on function public.admin_list_users(text, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer) to authenticated;
