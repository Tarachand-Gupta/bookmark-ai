import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";

/**
 * Account deletion — the Apple-required primitive (mobile/web UI wires this up
 * later). Authed via the gate (needs a real Clerk user). Deleting the Clerk user
 * fires a `user.deleted` webhook, which is what actually tears down the tenant's
 * DB — this route only removes the identity.
 */
export async function DELETE() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Open modes (keyless self-host / dev bypass) have no Clerk user to delete.
  if (!gate.userId) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 400 });
  }

  const client = await clerkClient();
  await client.users.deleteUser(gate.userId);
  return NextResponse.json({ ok: true }, { status: 202 });
}
