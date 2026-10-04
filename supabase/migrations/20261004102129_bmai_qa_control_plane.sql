SET local check_function_bodies = off;

CREATE SCHEMA "bmai_qa";

CREATE TABLE "bmai_qa"."accounts" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "state"      text                     NOT NULL DEFAULT 'active'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "accounts_state_check" CHECK ((state = ANY (ARRAY['active'::text, 'deleting'::text, 'deleted'::text])))
);

ALTER TABLE "bmai_qa"."accounts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."analytics_budgets" (
  "project_hash" text    NOT NULL,
  "month"        text    NOT NULL,
  "count"        integer NOT NULL,
  CONSTRAINT "analytics_budgets_count_check" CHECK ((count >= 0)),
  CONSTRAINT "analytics_budgets_pkey" PRIMARY KEY (project_hash, month)
);

ALTER TABLE "bmai_qa"."analytics_budgets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."app_releases" (
  "platform"              text                     NOT NULL,
  "version"               text                     NOT NULL,
  "build"                 text,
  "min_supported_version" text,
  "download_url"          text                     NOT NULL,
  "release_notes"         text,
  "published_at"          timestamp with time zone NOT NULL,
  "updated_at"            timestamp with time zone NOT NULL,
  CONSTRAINT "app_releases_pkey" PRIMARY KEY (platform)
);

ALTER TABLE "bmai_qa"."app_releases"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."identities" (
  "provider"   text NOT NULL,
  "subject"    uuid NOT NULL,
  "account_id" uuid NOT NULL,
  CONSTRAINT "identities_account_id_provider_key" UNIQUE (account_id, PROVIDER),
  CONSTRAINT "identities_pkey" PRIMARY KEY (PROVIDER, subject),
  CONSTRAINT "identities_provider_check" CHECK ((provider = 'supabase'::text))
);

ALTER TABLE "bmai_qa"."identities"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."macos_auth_flows" (
  "flow_id"           text   NOT NULL,
  "code_challenge"    text   NOT NULL,
  "verification_code" text   NOT NULL,
  "csrf_hash"         text,
  "csrf_user_id"      text,
  "csrf_session_id"   text,
  "clerk_user_id"     text,
  "state"             text   NOT NULL DEFAULT 'pending'::text,
  "created_at"        bigint NOT NULL,
  "expires_at"        bigint NOT NULL,
  "consumed_at"       bigint,
  CONSTRAINT "macos_auth_flows_pkey" PRIMARY KEY (flow_id),
  CONSTRAINT "macos_auth_flows_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'approved'::text, 'canceled'::text, 'consumed'::text])))
);

ALTER TABLE "bmai_qa"."macos_auth_flows"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."platform_config" (
  "key"        text                     NOT NULL,
  "value"      text                     NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_config_pkey" PRIMARY KEY (key)
);

ALTER TABLE "bmai_qa"."platform_config"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."session_labels" (
  "session_id"   uuid NOT NULL,
  "user_id"      uuid NOT NULL,
  "display_name" text,
  "client_type"  text NOT NULL,
  "browser"      text,
  "os"           text,
  "app_version"  text,
  CONSTRAINT "session_labels_app_version_check" CHECK ((length(app_version) <= 40)),
  CONSTRAINT "session_labels_browser_check" CHECK ((length(browser) <= 80)),
  CONSTRAINT "session_labels_display_name_check" CHECK ((length(display_name) <= 80)),
  CONSTRAINT "session_labels_os_check" CHECK ((length(os) <= 80)),
  CONSTRAINT "session_labels_pkey" PRIMARY KEY (session_id)
);

ALTER TABLE "bmai_qa"."session_labels"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."tenant_operations" (
  "account_id"       uuid                     NOT NULL,
  "kind"             text                     NOT NULL,
  "db_name"          text                     NOT NULL,
  "stage"            text                     NOT NULL DEFAULT 'pending'::text,
  "owned"            boolean                  NOT NULL DEFAULT false,
  "provider_subject" uuid,
  "lease_id"         uuid,
  "lease_until"      timestamp with time zone,
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_operations_db_name_check" CHECK ((db_name ~~ 'bmai-sbqa-%'::text)),
  CONSTRAINT "tenant_operations_kind_check" CHECK ((kind = ANY (ARRAY['provision'::text, 'delete'::text]))),
  CONSTRAINT "tenant_operations_pkey" PRIMARY KEY (account_id)
);

ALTER TABLE "bmai_qa"."tenant_operations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."tenants" (
  "account_id"            uuid                     NOT NULL,
  "db_name"               text                     NOT NULL,
  "db_url"                text                     NOT NULL,
  "credential_ciphertext" text                     NOT NULL,
  "status"                text                     NOT NULL DEFAULT 'active'::text,
  "plan"                  text                     NOT NULL DEFAULT 'free'::text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tenants_db_name_check" CHECK ((db_name ~~ 'bmai-sbqa-%'::text)),
  CONSTRAINT "tenants_db_name_key" UNIQUE (db_name),
  CONSTRAINT "tenants_pkey" PRIMARY KEY (account_id),
  CONSTRAINT "tenants_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'deleting'::text, 'disabled'::text])))
);

ALTER TABLE "bmai_qa"."tenants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "bmai_qa"."usage" (
  "account_id" uuid    NOT NULL,
  "day"        date    NOT NULL,
  "saves"      integer NOT NULL DEFAULT 0,
  "sessions"   integer NOT NULL DEFAULT 0,
  "chats"      integer NOT NULL DEFAULT 0,
  "searches"   integer NOT NULL DEFAULT 0,
  CONSTRAINT "usage_chats_check" CHECK ((chats >= 0)),
  CONSTRAINT "usage_pkey" PRIMARY KEY (account_id, day),
  CONSTRAINT "usage_saves_check" CHECK ((saves >= 0)),
  CONSTRAINT "usage_searches_check" CHECK ((searches >= 0)),
  CONSTRAINT "usage_sessions_check" CHECK ((sessions >= 0))
);

ALTER TABLE "bmai_qa"."usage"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION bmai_qa.manage_sessions (
  caller          uuid,
  current_session uuid,
  operation       text,
  target          uuid  DEFAULT NULL::uuid,
  metadata        jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

ALTER TABLE "bmai_qa"."identities"
  ADD CONSTRAINT "identities_account_id_fkey" FOREIGN KEY (account_id) REFERENCES bmai_qa.accounts(id);

ALTER TABLE "bmai_qa"."identities"
  ADD CONSTRAINT "identities_subject_fkey" FOREIGN KEY (subject) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "bmai_qa"."session_labels"
  ADD CONSTRAINT "session_labels_session_id_fkey" FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;

ALTER TABLE "bmai_qa"."session_labels"
  ADD CONSTRAINT "session_labels_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "bmai_qa"."tenant_operations"
  ADD CONSTRAINT "tenant_operations_account_id_fkey" FOREIGN KEY (account_id) REFERENCES bmai_qa.accounts(id);

ALTER TABLE "bmai_qa"."tenants"
  ADD CONSTRAINT "tenants_account_id_fkey" FOREIGN KEY (account_id) REFERENCES bmai_qa.accounts(id);

ALTER TABLE "bmai_qa"."usage"
  ADD CONSTRAINT "usage_account_id_fkey" FOREIGN KEY (account_id) REFERENCES bmai_qa.accounts(id);

CREATE INDEX macos_auth_expiry ON bmai_qa.macos_auth_flows USING btree (expires_at);

CREATE INDEX session_labels_user ON bmai_qa.session_labels USING btree (user_id);

CREATE POLICY "backend_accounts" ON "bmai_qa"."accounts"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_budget" ON "bmai_qa"."analytics_budgets"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_releases" ON "bmai_qa"."app_releases"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_identities" ON "bmai_qa"."identities"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_flows" ON "bmai_qa"."macos_auth_flows"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_config" ON "bmai_qa"."platform_config"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_labels" ON "bmai_qa"."session_labels"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_operations" ON "bmai_qa"."tenant_operations"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_tenants" ON "bmai_qa"."tenants"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "backend_usage" ON "bmai_qa"."usage"
  FOR ALL
  TO "bmai_qa_backend"
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON FUNCTION "bmai_qa"."manage_sessions"(uuid, uuid, text, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "bmai_qa"."manage_sessions"(uuid, uuid, text, uuid, jsonb) TO "bmai_qa_backend";

GRANT USAGE ON SCHEMA "bmai_qa" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."accounts" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."analytics_budgets" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."app_releases" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."identities" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."macos_auth_flows" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."platform_config" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."session_labels" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."tenant_operations" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."tenants" TO "bmai_qa_backend";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "bmai_qa"."usage" TO "bmai_qa_backend";
