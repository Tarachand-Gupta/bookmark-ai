/**
 * Firefox MV2 × `@clerk/chrome-extension`: make `runtime.getManifest()` carry
 * `host_permissions`.
 *
 * The SDK's `createClerkClient()` (used by the background) runs
 * `validateManifest(browser.runtime.getManifest(), { sync: true })`, which
 * throws `Missing \`host_permissions\` entry in manifest.json` unless that
 * top-level key is present. `host_permissions` is an MV3 key. Firefox does not
 * return the manifest FILE from `runtime.getManifest()` — it returns the
 * NORMALIZED manifest, and normalization drops keys the manifest version does
 * not support. So on the Firefox (MV2) target the key is gone at runtime no
 * matter what the file says, the SDK throws, and the background's SDK rung
 * (Path A — the one that carries dev-instance sessions) is dead on Firefox
 * while it works on Chrome. Verified 2026-09-03 via the background diag
 * (`token: sdk failed … Missing host_permissions`) with the key present in the
 * built manifest.json.
 *
 * The SDK only checks that the key is truthy (its contents are never read), so
 * the cheapest faithful fix is to hand it the host patterns WXT folded into
 * `permissions` for MV2 — exactly what `host_permissions` would have held.
 * Installed once at background boot, Firefox-only (see background.ts); a
 * failure to patch is diagnosed and leaves today's behavior (SDK throws →
 * native/device fallbacks) in place, never worse.
 *
 * Kept free of `wxt/browser`/`import.meta.env` so it is unit-testable in node.
 */

export interface ManifestLike {
  permissions?: readonly string[];
  host_permissions?: readonly string[];
  [key: string]: unknown;
}

export interface RuntimeLike {
  getManifest?: () => ManifestLike;
}

export type ShimOutcome =
  /** `getManifest` now returns `host_permissions`. */
  | "patched"
  /** The runtime manifest already had the key (MV3 targets) — nothing to do. */
  | "unneeded"
  /** No runtime / no `getManifest` to patch (unit tests, exotic hosts). */
  | "unavailable"
  /** The property could not be replaced; the SDK will throw as before. */
  | "failed";

/** A permission string that is a host match pattern, not an API permission. */
const HOST_PATTERN = /^(?:\*|https?|wss?|ftp|file):\/\/|^<all_urls>$/;

/** The host match patterns inside an MV2 `permissions` array. */
export function hostPatternsOf(permissions: readonly string[] | undefined): string[] {
  return (permissions ?? []).filter((p) => HOST_PATTERN.test(p));
}

/** Pure: the manifest with `host_permissions` present — the same object when it
 * already is, else a shallow copy carrying the host patterns from `permissions`. */
export function withHostPermissions<T extends ManifestLike>(manifest: T): T {
  if (manifest.host_permissions) return manifest;
  return { ...manifest, host_permissions: hostPatternsOf(manifest.permissions) };
}

/**
 * Replace `runtime.getManifest` with a wrapper that guarantees `host_permissions`.
 * Idempotent: a runtime whose manifest already carries the key is left alone.
 */
export function patchGetManifest(runtime: RuntimeLike | undefined): ShimOutcome {
  if (!runtime || typeof runtime.getManifest !== "function") return "unavailable";
  const original = runtime.getManifest.bind(runtime);
  let probe: ManifestLike | undefined;
  try {
    probe = original();
  } catch {
    return "failed";
  }
  if (probe?.host_permissions) return "unneeded";

  const patched = (): ManifestLike => withHostPermissions(original());
  try {
    Object.defineProperty(runtime, "getManifest", {
      value: patched,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch {
    try {
      (runtime as { getManifest: unknown }).getManifest = patched;
    } catch {
      return "failed";
    }
  }
  return runtime.getManifest === patched ? "patched" : "failed";
}
