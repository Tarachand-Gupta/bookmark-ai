import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

interface LegacySignIn {
  createdSessionId: string | null;
  firstFactorVerification: { status: string | null };
  create: (params: Record<string, unknown>) => Promise<LegacySignIn>;
}

interface LegacySignUp {
  createdSessionId: string | null;
  status: string | null;
  missingFields: string[];
  verifications: { externalAccount: { status: string | null } };
  create: (params: Record<string, unknown>) => Promise<LegacySignUp>;
}

interface AppleCredential {
  identityToken: string | null;
  fullName: { givenName: string | null; familyName: string | null } | null;
}

type AppleHook = () => {
  startAppleAuthenticationFlow: (params?: { unsafeMetadata?: Record<string, unknown> }) => Promise<{
    createdSessionId: string | null;
    signIn?: LegacySignIn;
    signUp?: LegacySignUp;
  }>;
};

const nodeRequire = createRequire(import.meta.url);
const expoPackage = nodeRequire.resolve("@clerk/expo/package.json");
const appleHookPath = join(dirname(expoPackage), "dist/hooks/useSignInWithApple.ios.js");

/**
 * Execute the actual installed, pnpm-patched iOS hook with only its platform and
 * Clerk dependencies replaced. Replacing dynamic import with the local require
 * shim keeps this a Node test while preserving every branch in the shipped hook.
 */
function loadInstalledHook(options: {
  signIn: LegacySignIn;
  signUp: LegacySignUp;
  signInAsync: (params?: Record<string, unknown>) => Promise<AppleCredential>;
}): AppleHook {
  const source = readFileSync(appleHookPath, "utf8")
    .replace(
      'import("expo-apple-authentication")',
      'Promise.resolve(require("expo-apple-authentication"))',
    )
    .replace('import("expo-crypto")', 'Promise.resolve(require("expo-crypto"))');
  const module = { exports: {} as { useSignInWithApple?: AppleHook } };
  const setActive = async () => {};
  const requireMock = (id: string): unknown => {
    if (id === "@clerk/shared/error") {
      return { isClerkAPIResponseError: () => false };
    }
    if (id === "@clerk/react/legacy") {
      return {
        useSignIn: () => ({ signIn: options.signIn, setActive, isLoaded: true }),
        useSignUp: () => ({ signUp: options.signUp, isLoaded: true }),
      };
    }
    if (id === "../utils/errors") {
      return {
        errorThrower: {
          throw(message: string): never {
            throw new Error(message);
          },
        },
      };
    }
    if (id === "expo-apple-authentication") {
      return {
        isAvailableAsync: async () => true,
        signInAsync: options.signInAsync,
        AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
      };
    }
    if (id === "expo-crypto") return { randomUUID: () => "test-nonce" };
    throw new Error(`Unexpected dependency: ${id}`);
  };

  Function("require", "module", "exports", source)(requireMock, module, module.exports);
  assert.ok(module.exports.useSignInWithApple, "installed iOS hook export is present");
  return module.exports.useSignInWithApple;
}

const signInResource = (): LegacySignIn => ({
  createdSessionId: null,
  firstFactorVerification: { status: null },
  async create() {
    return this;
  },
});

const signUpResource = (): LegacySignUp => ({
  createdSessionId: null,
  status: null,
  missingFields: [],
  verifications: { externalAccount: { status: null } },
  async create() {
    return this;
  },
});

describe("patched @clerk/expo native Apple hook", () => {
  it("rethrows cancellation even when persistent Clerk resources contain old progress", async () => {
    for (const staleSignUp of [
      {
        status: "missing_requirements",
        missingFields: ["phone_number"],
        externalStatus: "verified",
      },
      { status: "missing_requirements", missingFields: [], externalStatus: "verified" },
    ]) {
      const cancel = Object.assign(new Error("The user canceled."), {
        code: "ERR_REQUEST_CANCELED",
      });
      const signIn = signInResource();
      const signUp = signUpResource();
      signUp.status = staleSignUp.status;
      signUp.missingFields = staleSignUp.missingFields;
      signUp.verifications.externalAccount.status = staleSignUp.externalStatus;
      let createCalls = 0;
      signUp.create = async function () {
        createCalls += 1;
        return this;
      };
      const useSignInWithApple = loadInstalledHook({
        signIn,
        signUp,
        signInAsync: async () => Promise.reject(cancel),
      });

      await assert.rejects(
        useSignInWithApple().startAppleAuthenticationFlow(),
        (error) => error === cancel,
      );
      assert.equal(createCalls, 0, "a cancelled sheet never resumes the stale sign-up");
    }
  });

  it("preserves new-account token exchange and returned session behavior", async () => {
    const signIn = signInResource();
    const signUp = signUpResource();
    let appleRequest: Record<string, unknown> | undefined;
    let received: Record<string, unknown> | null = null;
    signUp.create = async function (params) {
      received = params;
      this.status = "complete";
      this.createdSessionId = "sess_new";
      this.verifications.externalAccount.status = "verified";
      return this;
    };
    const useSignInWithApple = loadInstalledHook({
      signIn,
      signUp,
      signInAsync: async (params) => {
        appleRequest = params;
        return {
          identityToken: "apple-id-token",
          fullName: { givenName: "Ada", familyName: "Lovelace" },
        };
      },
    });

    const result = await useSignInWithApple().startAppleAuthenticationFlow({
      unsafeMetadata: { source: "test" },
    });

    assert.deepEqual(appleRequest, { requestedScopes: [0, 1], nonce: "test-nonce" });
    assert.deepEqual(received, {
      strategy: "oauth_token_apple",
      token: "apple-id-token",
      firstName: "Ada",
      lastName: "Lovelace",
      unsafeMetadata: { source: "test" },
    });
    assert.equal(result.createdSessionId, "sess_new");
    assert.equal(result.signUp, signUp);
  });

  it("preserves the existing-account transfer handshake", async () => {
    const signIn = signInResource();
    const signUp = signUpResource();
    signUp.create = async function () {
      this.verifications.externalAccount.status = "transferable";
      return this;
    };
    let transferParams: Record<string, unknown> | null = null;
    signIn.create = async function (params) {
      transferParams = params;
      this.createdSessionId = "sess_existing";
      return this;
    };
    const useSignInWithApple = loadInstalledHook({
      signIn,
      signUp,
      signInAsync: async () => ({ identityToken: "apple-id-token", fullName: null }),
    });

    const result = await useSignInWithApple().startAppleAuthenticationFlow();

    assert.deepEqual(transferParams, { transfer: true });
    assert.equal(result.createdSessionId, "sess_existing");
    assert.equal(result.signIn, signIn);
  });
});
