// Type surface of safari-version.mjs for safari-version.test.ts (the script is
// plain ESM so `pnpm safari:xcode` can run it without a TS toolchain).
export const XCCONFIG_PATH: string;
export function parseVersion(version: string): { major: number; minor: number; patch: number };
export function deriveBuildNumber(version: string, suffix?: number | string): number;
export function renderXcconfig(version: string, build: number): string;
export function parseXcconfig(text: string): { version: string | undefined; build: number };
export function currentValues(env?: NodeJS.ProcessEnv): { version: string; build: number };
