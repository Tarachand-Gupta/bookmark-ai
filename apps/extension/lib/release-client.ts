import { browser } from "wxt/browser";
import type { ReleaseCommand, ReleaseReply } from "./release-background";
export async function releaseCommand(command: ReleaseCommand): Promise<ReleaseReply> {
  const response = (await browser.runtime.sendMessage({ type: "RELEASE_1", command })) as
    { ok?: boolean; value?: ReleaseReply; error?: string } | undefined;
  if (!response?.ok || !response.value)
    throw new Error(
      response?.error ?? "Background connection interrupted. Reopen to check the saved request.",
    );
  return response.value;
}
