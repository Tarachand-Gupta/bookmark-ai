import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appleButtonStyle,
  describeAppleSignInError,
  hasAppleAccount,
  offersAppleSignIn,
  resolveAppleFlow,
} from "./appleSignIn";

const freshSignUp = {
  status: null,
  missingFields: [] as string[],
  verifications: { externalAccount: { status: null } },
};
const freshSignIn = { status: null, firstFactorVerification: { status: null } };

describe("offersAppleSignIn", () => {
  it("is an iOS-only button", () => {
    assert.equal(offersAppleSignIn("ios"), true);
    assert.equal(offersAppleSignIn("android"), false);
    assert.equal(offersAppleSignIn("web"), false);
  });
});

describe("appleButtonStyle", () => {
  it("follows Apple's HIG: black on light, white on dark", () => {
    assert.equal(appleButtonStyle(false), "BLACK");
    assert.equal(appleButtonStyle(true), "WHITE");
  });
});

describe("resolveAppleFlow", () => {
  it("activates the session Clerk minted", () => {
    assert.deepEqual(
      resolveAppleFlow({ createdSessionId: "sess_1", signUp: freshSignUp, signIn: freshSignIn }),
      { kind: "activate", sessionId: "sess_1" },
    );
  });

  it("a session id wins over any resource state", () => {
    assert.deepEqual(
      resolveAppleFlow({
        createdSessionId: "sess_2",
        signUp: { ...freshSignUp, status: "missing_requirements", missingFields: ["email_address"] },
      }),
      { kind: "activate", sessionId: "sess_2" },
    );
  });

  it("a dismissed sheet leaves both resources untouched → cancelled, silently", () => {
    assert.deepEqual(resolveAppleFlow({ createdSessionId: null, signUp: freshSignUp, signIn: freshSignIn }), {
      kind: "cancelled",
    });
    // The hook returns the resources it holds, which may be absent before load.
    assert.deepEqual(resolveAppleFlow({ createdSessionId: null }), { kind: "cancelled" });
    // An untouched verification reports "unverified", not null (see the Google
    // path's QA notes) — treat both as no signal.
    assert.deepEqual(
      resolveAppleFlow({
        createdSessionId: null,
        signUp: { ...freshSignUp, verifications: { externalAccount: { status: "unverified" } } },
        signIn: { status: "needs_identifier", firstFactorVerification: { status: "unverified" } },
      }),
      { kind: "cancelled" },
    );
  });

  it("a first sign-up with nothing missing is completed with one empty update", () => {
    assert.deepEqual(
      resolveAppleFlow({
        createdSessionId: null,
        signUp: {
          status: "missing_requirements",
          missingFields: [],
          verifications: { externalAccount: { status: "verified" } },
        },
      }),
      { kind: "complete-signup" },
    );
  });

  it("a verified attempt Clerk could not finish is reported with its status", () => {
    assert.deepEqual(
      resolveAppleFlow({
        createdSessionId: null,
        signUp: {
          status: "missing_requirements",
          missingFields: ["phone_number"],
          verifications: { externalAccount: { status: "verified" } },
        },
      }),
      { kind: "unresolved", status: "missing_requirements" },
    );
    assert.deepEqual(
      resolveAppleFlow({
        createdSessionId: null,
        signUp: freshSignUp,
        signIn: { status: "needs_second_factor", firstFactorVerification: { status: "verified" } },
      }),
      { kind: "unresolved", status: "needs_second_factor" },
    );
  });
});

describe("describeAppleSignInError", () => {
  it("a cancel is not an error", () => {
    assert.deepEqual(describeAppleSignInError({ code: "ERR_REQUEST_CANCELED" }), { kind: "cancelled" });
  });

  it("Apple's device-side codes get copy that points at Settings / the other methods", () => {
    const unknown = describeAppleSignInError({ code: "ERR_REQUEST_UNKNOWN", message: "The operation couldn't be completed." });
    assert.equal(unknown.kind, "apple");
    assert.match(unknown.kind === "apple" ? unknown.message : "", /Apple Account in Settings/);
    const failed = describeAppleSignInError({ code: "ERR_REQUEST_FAILED" });
    assert.equal(failed.kind, "apple");
    assert.match(failed.kind === "apple" ? failed.message : "", /Google or your email/);
  });

  it("Clerk API errors surface Clerk's own (long) message verbatim", () => {
    assert.deepEqual(
      describeAppleSignInError({
        clerkError: true,
        errors: [{ code: "external_account_not_found", message: "short", longMessage: "The Apple account is not connected." }],
      }),
      { kind: "clerk", message: "The Apple account is not connected." },
    );
    assert.deepEqual(
      describeAppleSignInError({ errors: [{ code: "x", message: "Only message." }] }),
      { kind: "clerk", message: "Only message." },
    );
  });

  it("Clerk's 'not available on this device' throw is an Apple-side failure", () => {
    const res = describeAppleSignInError(new Error("Apple Authentication is not available on this device."));
    assert.equal(res.kind, "apple");
    assert.match(res.kind === "apple" ? res.message : "", /isn't available on this device/);
  });

  it("anything else keeps its message, with a fallback for empty ones", () => {
    assert.deepEqual(describeAppleSignInError(new Error("boom")), { kind: "unknown", message: "boom" });
    assert.deepEqual(describeAppleSignInError("plain"), { kind: "unknown", message: "plain" });
    const empty = describeAppleSignInError({});
    assert.equal(empty.kind, "unknown");
    assert.match(empty.kind === "unknown" ? empty.message : "", /didn't finish/);
  });
});

describe("hasAppleAccount", () => {
  it("spots an Apple external account among any others", () => {
    assert.equal(hasAppleAccount([]), false);
    assert.equal(hasAppleAccount([{ provider: "google" }]), false);
    assert.equal(hasAppleAccount([{ provider: "google" }, { provider: "apple" }]), true);
  });
});
