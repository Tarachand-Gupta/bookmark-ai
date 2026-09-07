/**
 * Store-readiness invariants of the Safari wrapper project (see
 * docs/safari-store-readiness.md). These are the things App Store Connect or
 * App Review rejects and that no compiler checks: bundle ids that disagree
 * between the Xcode spec and the Swift constant that queries Safari, a missing
 * sandbox entitlement (guideline 2.4.5), a privacy manifest that claims tracking
 * or forgets a collected type the store listing declares, a container app that
 * lost its category or its menu-bar flag.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

const projectYml = read("project.yml");
const companionModel = read("App/CompanionModel.swift");
const appPlist = read("App/Info.plist");
const appEntitlements = read("App/BookmarkAI.entitlements");
const appPrivacy = read("App/PrivacyInfo.xcprivacy");
const extPlist = read("Extension/Info.plist");
const extEntitlements = read("Extension/BookmarkAIExtension.entitlements");
const extPrivacy = read("Extension/PrivacyInfo.xcprivacy");

/** `<key>K</key>` immediately followed by the given value element. */
const plistHas = (xml: string, key: string, value: string) =>
  new RegExp(`<key>${key}</key>\\s*${value}`).test(xml);

describe("safari-app: bundle identity", () => {
  const appId = /PRODUCT_BUNDLE_IDENTIFIER:\s*(ai\.bookmark\.safari)\s*$/m.exec(projectYml)?.[1];
  const extId = /PRODUCT_BUNDLE_IDENTIFIER:\s*(ai\.bookmark\.safari\.Extension)\s*$/m.exec(projectYml)?.[1];

  it("declares the app id and an appex id prefixed by it", () => {
    expect(appId).toBe("ai.bookmark.safari");
    expect(extId).toBe("ai.bookmark.safari.Extension");
    expect(extId!.startsWith(appId! + ".")).toBe(true);
  });

  it("uses the SAME appex id in the Swift constant that asks Safari for its state", () => {
    expect(companionModel).toContain(`static let extensionBundleIdentifier = "${extId}"`);
  });

  it("keeps the Safari web-extension extension point on the appex", () => {
    expect(plistHas(extPlist, "NSExtensionPointIdentifier", "<string>com.apple.Safari.web-extension</string>")).toBe(true);
    expect(extPlist).toContain("$(PRODUCT_MODULE_NAME).SafariWebExtensionHandler");
  });
});

describe("safari-app: versions are build-setting driven (synced from package.json)", () => {
  it("both Info.plists take CFBundleShortVersionString/CFBundleVersion from Version.xcconfig", () => {
    for (const plist of [appPlist, extPlist]) {
      expect(plistHas(plist, "CFBundleShortVersionString", "<string>\\$\\(MARKETING_VERSION\\)</string>")).toBe(true);
      expect(plistHas(plist, "CFBundleVersion", "<string>\\$\\(CURRENT_PROJECT_VERSION\\)</string>")).toBe(true);
    }
    expect(projectYml).toMatch(/configFiles:\s*\n\s*Debug: Version\.xcconfig\s*\n\s*Release: Version\.xcconfig/);
  });
});

describe("safari-app: App Store Review 2.4.5 — sandbox", () => {
  it("both targets carry com.apple.security.app-sandbox and nothing broader", () => {
    for (const ent of [appEntitlements, extEntitlements]) {
      expect(plistHas(ent, "com.apple.security.app-sandbox", "<true/>")).toBe(true);
      const keys = [...ent.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
      expect(keys).toEqual(["com.apple.security.app-sandbox"]);
    }
    expect(projectYml).toMatch(/ENABLE_APP_SANDBOX:\s*YES/);
    expect(projectYml).toMatch(/ENABLE_HARDENED_RUNTIME:\s*YES/);
  });
});

describe("safari-app: container app metadata", () => {
  it("has a category, is a menu-bar app, and names itself distinctly from the desktop app", () => {
    expect(plistHas(appPlist, "LSApplicationCategoryType", "<string>public\\.app-category\\.productivity</string>")).toBe(true);
    expect(plistHas(appPlist, "LSUIElement", "<true/>")).toBe(true);
    expect(plistHas(appPlist, "CFBundleDisplayName", "<string>Bookmark AI for Safari</string>")).toBe(true);
    expect(plistHas(appPlist, "NSPrincipalClass", "<string>NSApplication</string>")).toBe(true);
    expect(plistHas(appPlist, "ITSAppUsesNonExemptEncryption", "<false/>")).toBe(true);
    // Programmatic UI: a storyboard key here would make AppKit look for a nib that no longer exists.
    expect(appPlist).not.toContain("NSMainStoryboardFile");
  });
});

describe("safari-app: privacy manifests (5.1.1) agree with the store declarations", () => {
  // = the CWS "Personally identifiable information + Authentication information +
  //   Web history" disclosures and AMO's authenticationInfo/bookmarksInfo/
  //   browsingActivity, in Apple's taxonomy.
  const REQUIRED_TYPES = [
    "NSPrivacyCollectedDataTypeEmailAddress",
    "NSPrivacyCollectedDataTypeName",
    "NSPrivacyCollectedDataTypeUserID",
    "NSPrivacyCollectedDataTypeBrowsingHistory",
    "NSPrivacyCollectedDataTypeOtherUserContent",
  ];

  for (const [name, xml] of [
    ["app", appPrivacy],
    ["appex", extPrivacy],
  ] as const) {
    it(`${name}: no tracking, every declared type linked + AppFunctionality`, () => {
      expect(plistHas(xml, "NSPrivacyTracking", "<false/>")).toBe(true);
      expect(xml).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
      const declared = [...xml.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/g)].map(
        (m) => m[1],
      );
      expect(declared.sort()).toEqual([...REQUIRED_TYPES].sort());
      // No entry may claim tracking or a non-functional purpose.
      expect(xml).not.toMatch(/<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
      expect(xml.match(/NSPrivacyCollectedDataTypePurposeAppFunctionality/g)?.length).toBe(REQUIRED_TYPES.length);
      expect(xml).not.toMatch(/Purpose(Analytics|ProductPersonalization|ThirdPartyAdvertising|DeveloperAdvertising)/);
    });
  }

  it("app declares the UserDefaults required-reason API it uses; appex declares none", () => {
    expect(appPrivacy).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(appPrivacy).toContain("<string>CA92.1</string>");
    expect(extPrivacy).toMatch(/<key>NSPrivacyAccessedAPITypes<\/key>\s*<array\/>/);
  });
});

describe("safari-app: the web-extension bundle layout the spec expects", () => {
  // scripts/safari-xcode.sh syncs .output/safari-mv3 into Extension/Resources and
  // fails on drift; this pins the list the script checks against.
  it("lists every top-level entry of a WXT safari-mv3 build", () => {
    for (const entry of ["manifest.json", "background.js", "popup.html", "assets", "chunks", "content-scripts", "icon"]) {
      expect(projectYml).toContain(`Extension/Resources/${entry}`);
    }
  });
});
