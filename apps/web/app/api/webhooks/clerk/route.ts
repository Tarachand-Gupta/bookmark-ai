import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { deprovisionTenant, provisionTenant } from "@bookmark-ai/engine";
import { getMasterContext, getPlatform } from "@/lib/server/context";

/**
 * Clerk webhook receiver — the provisioning trigger. PUBLIC route: it takes no
 * requireUser() gate; the svix signature over the raw body IS the authentication
 * (middleware already lets /api pass through). Runs REGARDLESS of MULTI_TENANT so
 * tenants can be pre-provisioned before the flag is flipped on.
 *
 * Flow: reject if no signing secret → verify the three svix headers against the
 * RAW body (before any JSON parse) → route on event type. Provisioning failures
 * return 500 so svix retries with backoff (that's the recovery mechanism), and
 * `user.deleted` treats an unconfigured master/platform as a 500 for the same
 * reason: a deletion we cannot perform must not be acknowledged.
 */

// A missing secret is a config gap, not a per-request error — log once.
let missingSecretWarned = false;

interface ClerkWebhookEvent {
  type: string;
  data: { id?: string };
}

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    if (!missingSecretWarned) {
      missingSecretWarned = true;
      console.warn("[webhook/clerk] CLERK_WEBHOOK_SECRET unset — webhooks are not configured");
    }
    return NextResponse.json({ error: "Webhooks not configured" }, { status: 503 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix signature headers" }, { status: 400 });
  }

  // The signature is over the RAW body — read text() BEFORE any JSON parse.
  const payload = await req.text();
  let event: ClerkWebhookEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const master = getMasterContext();
  const platform = getPlatform();

  try {
    if (event.type === "user.created") {
      const clerkUserId = event.data.id;
      if (!clerkUserId) {
        return NextResponse.json({ error: "Missing user id" }, { status: 400 });
      }
      if (master && platform) {
        await master.ready;
        await provisionTenant({ master: master.db, platform, clerkUserId });
      } else {
        console.warn(
          "[webhook/clerk] user.created but master/platform not configured — skipping provision",
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (event.type === "user.deleted") {
      const clerkUserId = event.data.id;
      if (!clerkUserId) {
        // Unactionable, and no retry can supply the id — 400 surfaces it in the
        // Clerk dashboard rather than pretending the erasure happened.
        return NextResponse.json({ error: "Missing user id" }, { status: 400 });
      }
      // Erasure must never fail open. Without master+platform we cannot delete
      // the tenant DB (nor the master row holding its full-access token), and a
      // 200 makes svix drop the event forever — the Clerk identity disappears
      // while the user's data lives on. Unlike user.created there is no request
      // path that can heal this later: the identity is already gone. So 500 and
      // let svix retry; a genuinely unconfigured deploy then shows up as a
      // failed webhook instead of silence.
      if (!master || !platform) {
        console.error(
          "[webhook/clerk] user.deleted but master/platform not configured — cannot erase tenant data",
        );
        return NextResponse.json({ error: "Deprovisioning not configured" }, { status: 500 });
      }
      await master.ready;
      // Idempotent + tolerates an absent tenant (deterministic DB name).
      await deprovisionTenant({ master: master.db, platform, clerkUserId });
      return NextResponse.json({ ok: true });
    }

    // Every other event: acknowledged, ignored.
    return NextResponse.json({ ok: true });
  } catch (err) {
    // 500 → svix retries with backoff, which is how a transient Turso/Platform
    // failure eventually recovers.
    console.error(`[webhook/clerk] ${event.type} failed:`, err);
    return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
  }
}
