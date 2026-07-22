---
slug: /self-hosting/multi-tenant
title: Multi-tenant
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
MULTI_TENANT=1                 # off/unset = single shared database
MASTER_DATABASE_URL=...        # the control-plane database
```

Tenant databases can be real **Turso** databases (provisioned through the Turso
Platform API) in production, or plain **sqlite files** in local development, so
you can run multi-tenant mode fully offline while developing.

Per-user daily quotas (saves, sessions, chats) are enforced in this mode.

:::note
Most self-hosters don't need this — leave `MULTI_TENANT` unset for the simple
single-database setup. Multi-tenant mode is for running Bookmark AI as a service
for many users. See the repository's `.env.example` for the full set of
tenant-related variables.
:::
