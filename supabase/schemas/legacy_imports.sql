-- Exact imported routing provenance. Authentication remains exclusively Supabase.
create table bmai_qa.legacy_imports (
  account_id uuid primary key references bmai_qa.accounts(id),
  clerk_subject text unique not null check (clerk_subject ~ '^user_[A-Za-z0-9]+$'),
  db_name text unique not null check (db_name ~ '^[a-z0-9-]+$'),
  db_url text unique not null,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  identity_evidence text not null check (identity_evidence in ('provider-subject','admin-verified-email')),
  prior_tenant jsonb,
  prior_operation jsonb,
  imported_at timestamptz not null default now()
);
alter table bmai_qa.legacy_imports enable row level security;
revoke all on bmai_qa.legacy_imports from public,anon,authenticated;
grant select,insert,update,delete on bmai_qa.legacy_imports to bmai_qa_backend;
create policy backend_only on bmai_qa.legacy_imports to bmai_qa_backend using(true) with check(true);

-- A deferred guard permits an atomic route+provenance change/rollback while
-- refusing any committed unproven legacy route, including a provenance delete.
create function bmai_qa.check_tenant_route_provenance() returns trigger
language plpgsql set search_path='' as $$
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
$$;
create constraint trigger tenants_route_provenance after insert or update or delete on bmai_qa.tenants
  deferrable initially deferred for each row execute function bmai_qa.check_tenant_route_provenance();
create constraint trigger legacy_route_provenance after insert or update or delete on bmai_qa.legacy_imports
  deferrable initially deferred for each row execute function bmai_qa.check_tenant_route_provenance();

create function bmai_qa.guard_imported_operation() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from bmai_qa.legacy_imports where account_id=NEW.account_id) then
    raise exception 'Imported tenant cannot enter automatic QA provisioning or deletion';
  end if;
  return NEW;
end;
$$;
create trigger imported_operations_guard before insert or update on bmai_qa.tenant_operations
  for each row execute function bmai_qa.guard_imported_operation();

create function bmai_qa.guard_legacy_import_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if NEW.account_id<>OLD.account_id or NEW.clerk_subject<>OLD.clerk_subject or NEW.db_name<>OLD.db_name or NEW.db_url<>OLD.db_url or NEW.source_digest<>OLD.source_digest or NEW.identity_evidence<>OLD.identity_evidence then
    raise exception 'Imported ownership provenance is immutable';
  end if;
  return NEW;
end;
$$;
create trigger legacy_import_identity_guard before update on bmai_qa.legacy_imports
  for each row execute function bmai_qa.guard_legacy_import_identity();
revoke all on function bmai_qa.check_tenant_route_provenance(), bmai_qa.guard_imported_operation(), bmai_qa.guard_legacy_import_identity() from public,anon,authenticated;
