import { describe, expect, it } from "vitest";
import {
  APP_PAGE_MATCHES,
  DEV_HOST_PERMISSIONS,
  PROD_APP_PAGE_MATCHES,
  PROD_HOST_PERMISSIONS,
  PRODUCTION_MODE,
  appPageMatchesFor,
  hostPermissionsFor,
} from "./app-origins";

/**
 * Store-critical invariants: a `production` build (every Chrome Web Store /
 * AMO / Safari zip) may request ONLY the four production origins, and both
 * detection channels (Chrome externally_connectable, the Firefox/Safari marker
 * content script) read the same per-mode page list.
 */

const MATCH_PATTERN = /^https?:\/\/[a-z0-9.-]+\/\*$/;

describe("hostPermissionsFor", () => {
  it("production requests exactly the four prod origins — nothing dev, nothing local", () => {
    expect([...hostPermissionsFor(PRODUCTION_MODE)]).toEqual([
      "https://bookmark-ai.cloud/*",
      "https://www.bookmark-ai.cloud/*",
      "https://clerk.bookmark-ai.cloud/*",
      "https://live.bookmark-ai.cloud/*",
    ]);
  });

  it("production never carries a localhost, vercel or dev-Clerk pattern", () => {
    for (const pattern of hostPermissionsFor("production")) {
      expect(pattern).not.toMatch(/localhost|vercel\.app|clerk\.accounts\.dev/);
      expect(pattern).toMatch(/^https:\/\//);
    }
  });

  it("dev-remote and development get the superset (prod + localhost + dev deployment + dev Clerk)", () => {
    for (const mode of ["development", "dev-remote"]) {
      const hosts = hostPermissionsFor(mode);
      expect(hosts).toBe(DEV_HOST_PERMISSIONS);
      for (const prod of PROD_HOST_PERMISSIONS) expect(hosts).toContain(prod);
      // Ports are ignored in match patterns → covers the dev server on :3000.
      expect(hosts).toContain("http://localhost/*");
      expect(hosts).toContain("https://bookmark-ai-dev.vercel.app/*");
      expect(hosts).toContain("https://darling-baboon-13.clerk.accounts.dev/*");
    }
  });

  it("an unknown mode is treated as non-production (never silently over-trims a dev build)", () => {
    expect(hostPermissionsFor("")).toBe(DEV_HOST_PERMISSIONS);
    expect(hostPermissionsFor("staging")).toBe(DEV_HOST_PERMISSIONS);
  });

  it("only lists host match patterns (no wildcard host, no duplicates)", () => {
    for (const list of [PROD_HOST_PERMISSIONS, DEV_HOST_PERMISSIONS]) {
      for (const pattern of list) expect(pattern).toMatch(MATCH_PATTERN);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("appPageMatchesFor", () => {
  it("production = the two prod web-app origins only", () => {
    expect([...appPageMatchesFor(PRODUCTION_MODE)]).toEqual([
      "https://bookmark-ai.cloud/*",
      "https://www.bookmark-ai.cloud/*",
    ]);
    expect(appPageMatchesFor("production")).toBe(PROD_APP_PAGE_MATCHES);
  });

  /** Both detection channels read this list (Chrome's externally_connectable in
   * wxt.config.ts, the marker content script's `matches`), so a missing origin
   * blinds detection on that origin. */
  it("dev/local cover every origin the web app is served from", () => {
    for (const mode of ["development", "dev-remote"]) {
      const pages = appPageMatchesFor(mode);
      expect(pages).toBe(APP_PAGE_MATCHES);
      expect(pages).toContain("https://bookmark-ai.cloud/*");
      expect(pages).toContain("https://www.bookmark-ai.cloud/*");
      expect(pages).toContain("https://bookmark-ai-dev.vercel.app/*");
      expect(pages).toContain("http://localhost/*");
    }
  });

  it("every page origin a build may talk to is also a host it may reach", () => {
    for (const mode of ["production", "development", "dev-remote"]) {
      const hosts = hostPermissionsFor(mode);
      for (const page of appPageMatchesFor(mode)) {
        // The theta alias is a legacy preview origin kept for detection only.
        if (page.includes("bookmark-ai-theta")) continue;
        expect(hosts).toContain(page);
      }
    }
  });

  it("only lists page origins (no wildcard host)", () => {
    for (const pattern of APP_PAGE_MATCHES) expect(pattern).toMatch(MATCH_PATTERN);
  });
});
