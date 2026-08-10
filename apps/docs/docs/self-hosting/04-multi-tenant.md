---
slug: /self-hosting/multi-tenant
title: Multi-tenant
description: Single-DB or per-user databases behind a control plane.
sidebar_custom_props:
  icon: 🏢
---

# Multi-tenant

By default a self-hosted instance uses a **single shared database** — fine for
yourself or a small trusted group. There's also an optional **multi-tenant**
mode that gives every user their own database behind a control plane.

## How it works

- A **master (control-plane) database** holds the tenant directory and per-day
  usage counters.
- Each user reads and writes **their own database**, so tenants are isolated.
- Provisioning happens via a Clerk webhook as users sign up.

It's turned on with an environment flag:

```bash
MULTI_TENANT=1                      # off/unset = single shared database
MASTER_DATABASE_URL=...             # the control-plane database
MASTER_DATABASE_AUTH_TOKEN=...      # required for a libsql:// master URL

# Provisioning each tenant's Turso database (production).
TURSO_API_TOKEN=...                 # turso auth api-tokens mint
TURSO_ORG=...
TURSO_GROUP=default

# Or provision tenants as local sqlite FILES instead — dev only, ignored when
# NODE_ENV=production, so multi-tenant mode runs fully offline.
TENANT_PLATFORM=local
TENANT_DB_DIR=../../data/tenants

# Clerk webhook signing secret — this is what provisions and tears down
# tenants as users sign up and delete their accounts.
CLERK_WEBHOOK_SECRET=whsec_...
```

Tenant databases can be real **Turso** databases (provisioned through the Turso
Platform API) in production, or plain **sqlite files** in local development, so
you can run multi-tenant mode fully offline while developing.

The Clerk webhook route provisions and deprovisions tenants **regardless of the
flag**, so you can pre-provision before flipping `MULTI_TENANT=1`. Until a
tenant's database is ready, that account's API calls return
`503 { "error": "Account not provisioned yet", "code": "provisioning" }`.

## Per-account daily quotas

Quotas are enforced only in this mode (they're a per-user concern, and there's no
per-user anything on a single shared database). Per account, per UTC day:

```bash
QUOTA_SAVES_PER_DAY=200        # defaults shown
QUOTA_SESSIONS_PER_DAY=50
QUOTA_CHATS_PER_DAY=100
QUOTA_SEARCHES_PER_DAY=500     # only hybrid/ai searches are charged
```

Over a limit, the request returns
`429 { "error": "Daily limit reached (<what>). Resets at midnight UTC." }`. Plain
`text` search is never charged, and an import costs one save unit rather than one
per bookmark, so restoring a big library can't burn a day's quota.

## The AI credit budget lives here too

The master database is also where the fleet-wide free weekly AI token budget is
stored, which is what makes it adjustable at all: `GET`/`PATCH
/api/admin/ai-limit` (restricted to `ADMIN_USER_IDS`) read and write it, and
without a master database the compiled default applies and can't be changed. See
[Web & API](/self-hosting/web-and-api#ai-metering-on-a-self-hosted-instance).

:::note
Most self-hosters don't need this — leave `MULTI_TENANT` unset for the simple
single-database setup. Multi-tenant mode is for running Bookmark AI as a service
for many users. See the repository's `.env.example` for the full set of
tenant-related variables.
:::
