import { createServerLogger } from "@bookmark-ai/server-logging";

// Instrumentation and route handlers are separate Next bundles; share one queue.
const store = globalThis as unknown as {
  __bookmarkServerLogger?: ReturnType<typeof createServerLogger>;
};
export const serverLogger = store.__bookmarkServerLogger ??=
  createServerLogger({ service: "bookmark-ai-web" });
