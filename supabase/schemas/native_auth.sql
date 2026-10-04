-- Temporary transport only: authentication, MFA, rotation and revocation remain Supabase-owned.
create table if not exists bmai_qa.native_auth_flows (
  flow_id text primary key check (length(flow_id)=43),
  code_challenge text not null check (length(code_challenge)=43),
  browser_nonce_hash text not null,
  completion_code_hash text,
  native_state text not null check (length(native_state)=43),
  client_type text not null check (client_type in ('macos','ios','android')),
  callback_url text not null,
  state text not null default 'pending' check (state in ('pending','completing','ready','consumed','canceled')),
  payload_ciphertext text,
  provider_user_id uuid,
  session_id uuid,
  created_at bigint not null,
  expires_at bigint not null
);
create index if not exists native_auth_flows_expiry on bmai_qa.native_auth_flows(expires_at);
alter table bmai_qa.native_auth_flows enable row level security;
revoke all on bmai_qa.native_auth_flows from public, anon, authenticated;
grant select, insert, update, delete on bmai_qa.native_auth_flows to bmai_qa_backend;
create policy backend_native_flows on bmai_qa.native_auth_flows to bmai_qa_backend using(true) with check(true);
