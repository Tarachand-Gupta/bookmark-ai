alter table "bmai_qa"."tenants" drop constraint "tenants_db_name_check";


  create table "bmai_qa"."legacy_imports" (
    "account_id" uuid not null,
    "clerk_subject" text not null,
    "db_name" text not null,
    "db_url" text not null,
    "source_digest" text not null,
    "identity_evidence" text not null,
    "prior_tenant" jsonb,
    "prior_operation" jsonb,
    "imported_at" timestamp with time zone not null default now()
      );


alter table "bmai_qa"."legacy_imports" enable row level security;

alter table "bmai_qa"."usage" add column "newtab_templates" integer not null default 0;

CREATE UNIQUE INDEX legacy_imports_clerk_subject_key ON bmai_qa.legacy_imports USING btree (clerk_subject);

CREATE UNIQUE INDEX legacy_imports_db_name_key ON bmai_qa.legacy_imports USING btree (db_name);

CREATE UNIQUE INDEX legacy_imports_db_url_key ON bmai_qa.legacy_imports USING btree (db_url);

CREATE UNIQUE INDEX legacy_imports_pkey ON bmai_qa.legacy_imports USING btree (account_id);

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_pkey" PRIMARY KEY using index "legacy_imports_pkey";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_account_id_fkey" FOREIGN KEY (account_id) REFERENCES bmai_qa.accounts(id) not valid;

alter table "bmai_qa"."legacy_imports" validate constraint "legacy_imports_account_id_fkey";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_clerk_subject_check" CHECK ((clerk_subject ~ '^user_[A-Za-z0-9]+$'::text)) not valid;

alter table "bmai_qa"."legacy_imports" validate constraint "legacy_imports_clerk_subject_check";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_clerk_subject_key" UNIQUE using index "legacy_imports_clerk_subject_key";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_db_name_check" CHECK ((db_name ~ '^[a-z0-9-]+$'::text)) not valid;

alter table "bmai_qa"."legacy_imports" validate constraint "legacy_imports_db_name_check";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_db_name_key" UNIQUE using index "legacy_imports_db_name_key";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_db_url_key" UNIQUE using index "legacy_imports_db_url_key";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_identity_evidence_check" CHECK ((identity_evidence = ANY (ARRAY['provider-subject'::text, 'admin-verified-email'::text]))) not valid;

alter table "bmai_qa"."legacy_imports" validate constraint "legacy_imports_identity_evidence_check";

alter table "bmai_qa"."legacy_imports" add constraint "legacy_imports_source_digest_check" CHECK ((source_digest ~ '^[a-f0-9]{64}$'::text)) not valid;

alter table "bmai_qa"."legacy_imports" validate constraint "legacy_imports_source_digest_check";

alter table "bmai_qa"."usage" add constraint "usage_newtab_templates_check" CHECK ((newtab_templates >= 0)) not valid;

alter table "bmai_qa"."usage" validate constraint "usage_newtab_templates_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION bmai_qa.check_tenant_route_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare owner_id uuid; route record; provenance record;
begin
  owner_id:=case when TG_OP='DELETE' then OLD.account_id else NEW.account_id end;
  select * into route from bmai_qa.tenants where account_id=owner_id;
  if not found then return null; end if;
  select * into provenance from bmai_qa.legacy_imports where account_id=owner_id;
  if found then
    if route.db_name<>provenance.db_name or route.db_url<>provenance.db_url then
      raise exception 'Imported tenant route does not match provenance';
    end if;
  elsif route.db_name !~ '^bmai-sbqa-[a-f0-9]{24,64}$' then
    raise exception 'Tenant route lacks exact imported provenance';
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION bmai_qa.guard_imported_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if exists(select 1 from bmai_qa.legacy_imports where account_id=NEW.account_id) then
    raise exception 'Imported tenant cannot enter automatic QA provisioning or deletion';
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION bmai_qa.guard_legacy_import_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if NEW.account_id<>OLD.account_id or NEW.clerk_subject<>OLD.clerk_subject or NEW.db_name<>OLD.db_name or NEW.db_url<>OLD.db_url or NEW.source_digest<>OLD.source_digest or NEW.identity_evidence<>OLD.identity_evidence then
    raise exception 'Imported ownership provenance is immutable';
  end if;
  return NEW;
end;
$function$
;

grant delete on table "bmai_qa"."legacy_imports" to "bmai_qa_backend";

grant insert on table "bmai_qa"."legacy_imports" to "bmai_qa_backend";

grant select on table "bmai_qa"."legacy_imports" to "bmai_qa_backend";

grant update on table "bmai_qa"."legacy_imports" to "bmai_qa_backend";


  create policy "backend_only"
  on "bmai_qa"."legacy_imports"
  as permissive
  for all
  to bmai_qa_backend
using (true)
with check (true);


CREATE TRIGGER legacy_import_identity_guard BEFORE UPDATE ON bmai_qa.legacy_imports FOR EACH ROW EXECUTE FUNCTION bmai_qa.guard_legacy_import_identity();

CREATE CONSTRAINT TRIGGER legacy_route_provenance AFTER INSERT OR DELETE OR UPDATE ON bmai_qa.legacy_imports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bmai_qa.check_tenant_route_provenance();

CREATE TRIGGER imported_operations_guard BEFORE INSERT OR UPDATE ON bmai_qa.tenant_operations FOR EACH ROW EXECUTE FUNCTION bmai_qa.guard_imported_operation();

CREATE CONSTRAINT TRIGGER tenants_route_provenance AFTER INSERT OR DELETE OR UPDATE ON bmai_qa.tenants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bmai_qa.check_tenant_route_provenance();



-- Retain explicit private privileges across production default grants (migra omission).
revoke all on table bmai_qa.legacy_imports from public,anon,authenticated;
revoke all on function bmai_qa.check_tenant_route_provenance(), bmai_qa.guard_imported_operation(), bmai_qa.guard_legacy_import_identity() from public,anon,authenticated;
