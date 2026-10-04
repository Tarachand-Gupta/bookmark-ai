-- Isolated QA control plane. Application startup never applies this schema.
create schema if not exists bmai_qa;
revoke all on schema bmai_qa from public, anon, authenticated;
grant usage on schema bmai_qa to bmai_qa_backend;

create table bmai_qa.accounts (
  id uuid primary key default gen_random_uuid(),
  state text not null default 'active' check (state in ('active','deleting','deleted')),
  created_at timestamptz not null default now()
);
create table bmai_qa.identities (
  provider text not null check (provider = 'supabase'),
  subject uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references bmai_qa.accounts(id),
  primary key(provider, subject), unique(account_id, provider)
);
create table bmai_qa.tenants (
  account_id uuid primary key references bmai_qa.accounts(id),
  db_name text unique not null, -- exact QA/import routing guarded by legacy_imports.sql
  db_url text not null,
  credential_ciphertext text not null,
  status text not null default 'active' check (status in ('active','deleting','disabled')),
  plan text not null default 'free', created_at timestamptz not null default now()
);
create table bmai_qa.usage (
  account_id uuid not null references bmai_qa.accounts(id), day date not null,
  saves integer not null default 0 check(saves >= 0),
  sessions integer not null default 0 check(sessions >= 0),
  chats integer not null default 0 check(chats >= 0),
  searches integer not null default 0 check(searches >= 0),
  newtab_templates integer not null default 0 check(newtab_templates >= 0),
  primary key(account_id, day)
);
create table bmai_qa.platform_config (key text primary key, value text not null, updated_at timestamptz not null default now());
create table bmai_qa.analytics_budgets (project_hash text not null, month text not null, count integer not null check(count >= 0), primary key(project_hash, month));
create table bmai_qa.app_releases (
  platform text primary key, version text not null, build text, min_supported_version text,
  download_url text not null, release_notes text, published_at timestamptz not null, updated_at timestamptz not null
);
create table bmai_qa.macos_auth_flows (
  flow_id text primary key, code_challenge text not null, verification_code text not null,
  csrf_hash text, csrf_user_id text, csrf_session_id text, clerk_user_id text,
  state text not null default 'pending' check(state in ('pending','approved','canceled','consumed')),
  created_at bigint not null, expires_at bigint not null, consumed_at bigint
);
create index macos_auth_expiry on bmai_qa.macos_auth_flows(expires_at);
-- Receipts intentionally survive auth.users deletion; recovery must not lose ownership.
create table bmai_qa.tenant_operations (
  account_id uuid primary key references bmai_qa.accounts(id),
  kind text not null check(kind in ('provision','delete')),
  db_name text not null check(db_name like 'bmai-sbqa-%'),
  stage text not null default 'pending', owned boolean not null default false,
  provider_subject uuid, lease_id uuid, lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table bmai_qa.session_labels (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text, client_type text not null,
  browser text, os text, app_version text,
  check(length(display_name) <= 80), check(length(browser) <= 80), check(length(os) <= 80), check(length(app_version) <= 40)
);
create index session_labels_user on bmai_qa.session_labels(user_id);

-- No public client has access; RLS is defense in depth in this private schema.
alter table bmai_qa.accounts enable row level security;
alter table bmai_qa.identities enable row level security;
alter table bmai_qa.tenants enable row level security;
alter table bmai_qa.usage enable row level security;
alter table bmai_qa.platform_config enable row level security;
alter table bmai_qa.analytics_budgets enable row level security;
alter table bmai_qa.app_releases enable row level security;
alter table bmai_qa.macos_auth_flows enable row level security;
alter table bmai_qa.tenant_operations enable row level security;
alter table bmai_qa.session_labels enable row level security;
grant select, insert, update, delete on all tables in schema bmai_qa to bmai_qa_backend;
create policy backend_accounts on bmai_qa.accounts to bmai_qa_backend using(true) with check(true);
create policy backend_identities on bmai_qa.identities to bmai_qa_backend using(true) with check(true);
create policy backend_tenants on bmai_qa.tenants to bmai_qa_backend using(true) with check(true);
create policy backend_usage on bmai_qa.usage to bmai_qa_backend using(true) with check(true);
create policy backend_config on bmai_qa.platform_config to bmai_qa_backend using(true) with check(true);
create policy backend_budget on bmai_qa.analytics_budgets to bmai_qa_backend using(true) with check(true);
create policy backend_releases on bmai_qa.app_releases to bmai_qa_backend using(true) with check(true);
create policy backend_flows on bmai_qa.macos_auth_flows to bmai_qa_backend using(true) with check(true);
create policy backend_operations on bmai_qa.tenant_operations to bmai_qa_backend using(true) with check(true);
create policy backend_labels on bmai_qa.session_labels to bmai_qa_backend using(true) with check(true);

-- Privileged native adapter: callable only by the server DB role. Every operation
-- validates the already-online-verified caller's native session again under locks.
create function bmai_qa.manage_sessions(caller uuid, current_session uuid, operation text, target uuid default null, metadata jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  -- Serialize adapter mutations by owner before taking any native session lock.
  -- Reciprocal A->B / B->A revoke cannot lock the two sessions in reverse order.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 20261004));
  perform 1 from auth.sessions where id=current_session and user_id=caller for update;
  if not found then raise exception 'session_not_found' using errcode='28000'; end if;
  if operation='register' then
    insert into bmai_qa.session_labels(session_id,user_id,display_name,client_type,browser,os,app_version)
      values(current_session,caller,metadata->>'displayName',metadata->>'clientType',metadata->>'browser',metadata->>'os',metadata->>'appVersion')
      on conflict(session_id) do update set client_type=excluded.client_type,browser=excluded.browser,os=excluded.os,app_version=excluded.app_version;
  elsif operation='rename' then
    if not exists(select 1 from auth.sessions where id=target and user_id=caller) then return null; end if;
    insert into bmai_qa.session_labels(session_id,user_id,display_name,client_type) values(target,caller,metadata->>'displayName','web')
      on conflict(session_id) do update set display_name=excluded.display_name;
  elsif operation='revoke' then
    delete from auth.sessions where id=target and user_id=caller;
    return to_jsonb(found);
  elsif operation='local' then
    delete from auth.sessions where id=current_session and user_id=caller; return 'true'::jsonb;
  elsif operation='others' then
    delete from auth.sessions where user_id=caller and id<>current_session; return 'true'::jsonb;
  elsif operation='global' then
    delete from auth.sessions where user_id=caller; return 'true'::jsonb;
  elsif operation<>'list' then raise exception 'invalid_session_operation';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'displayName',coalesce(l.display_name,'Unknown device'),'clientType',coalesce(l.client_type,'web'),
    'browser',l.browser,'os',l.os,'createdAt',s.created_at,'lastActiveAt',coalesce(s.refreshed_at,s.updated_at,s.created_at),
    'isCurrent',s.id=current_session) order by s.created_at desc),'[]'::jsonb)
  into result from auth.sessions s left join bmai_qa.session_labels l on l.session_id=s.id and l.user_id=caller where s.user_id=caller;
  return result;
end;
$$;
revoke all on function bmai_qa.manage_sessions(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function bmai_qa.manage_sessions(uuid,uuid,text,uuid,jsonb) to bmai_qa_backend;
