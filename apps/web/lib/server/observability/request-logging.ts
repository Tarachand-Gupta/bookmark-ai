import { after } from "next/server";
import { serverLogger } from "./server-logs";

/** Pass only the source-code route template; never inspect the request URL/body. */
export function withRequestLogging<Args extends unknown[], Result extends Response>(
  route: string,
  method: string,
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    const start = performance.now();
    try {
      const response = await handler(...args);
      serverLogger.log(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info", "api_request", {
        route, method, status: response.status, durationMs: performance.now() - start,
      });
      return response;
    } catch (error) {
      serverLogger.log("error", "api_request_failed", {
        route, method, durationMs: performance.now() - start, error,
      });
      throw error;
    } finally {
      // Next keeps this work alive after the response, including stream closure.
      try {
        after(() => serverLogger.flush());
      } catch {
        // Direct invocations/tests may have no Next request lifecycle.
        await serverLogger.flush();
      }
    }
  };
}
