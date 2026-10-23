# Chat restoration, local AI and bottom scrolling

This is a local candidate on `codex/chat-restore-local-ai-oct23`. The production deployment has not changed during this pass.

## Corrections

- A persisted conversation ID is a conversation awaiting history, not an empty chat. While history loads, show an accessible loading state, hide starter suggestions and block submission. Retain typed drafts.
- History loads are single-flight per thread. A late result cannot select a different chat, replace live messages, or restore a removed/disposed account's thread. Loading failures retain drafts and offer Retry / New conversation.
- Starter suggestions appear only in an actual new conversation. Outgoing carousel pages are inert as well as hidden from accessibility. The existing rotation is retained.
- Each selected thread receives a fresh scroll controller. Initial positioning, content following and the bottom arrow settle directly, with native scroll anchoring disabled in the managed scroller. A one-pixel tolerance accepts fractional browser scroll positions: rounded scroll heights can otherwise leave an unreachable target and an endless animation loop. Manual scrolling still escapes bottom following.

## Real AI on localhost

The previous listener on port 3000 served an old isolated fixture whose chat route returned a deterministic mock answer. It has been replaced with the current product chat route and configured server-side model credentials.

Run `corepack pnpm dev:web:ai` from the repository root. This reuses the existing local preview at `.work/release-1/web-fixture` (an alternative existing `.work` preview can be passed as the argument). It requires port 3000 to be free, refreshes product sources on startup, preserves fixture authentication and databases, and keeps database routing restricted to the five local fixture identities. It refuses stale critical sources or app environment files. Restart the command after root source changes to refresh the isolated copy.

Only selected AI configuration is loaded from ignored root env files. Production database, master, auth and Redis credentials are excluded. The server listens on `127.0.0.1:3000`. This is a **real model with a local test library**, not real Supabase provider-auth E2E or a copy of the owner's production library. No fixture authentication changes belong in product source or deployment packages.

The current OpenRouter provider policy rejected the primary request; the real Gemini fallback completed all three UI requests. Cloudflare credentials remain unconfigured in this local run. Historical mock answers remain in old local conversations; new requests use the real route.

## Evidence

- All 996 web tests pass across 93 files; web typechecking and launcher syntax checking pass. New tests cover delayed history, switching to a new chat while restoration is pending, exact user-message retention, retry/failure, account disposal/removal, and fractional bottom targets.
- Clicked the exact weekly-count starter suggestion. Its user message appeared immediately and survived refresh, along with its answer. The model queried this week's dates (October 19–23), reported zero, and correctly noted 512 bookmarks on October 16. A real follow-up returned 512 plus 20 linked bookmarks. Those dates and the total match the isolated fixture library.
- With a fixture-only 1.8-second history delay, clicked New conversation during restoration and submitted a real count question. The late old history did not replace the new message or change the active chat. The answer was 512. The artificial delay was removed before the final server restart.
- The launcher refreshed the preview and started successfully; a second launch while port 3000 was occupied refused before copying files. Critical product sources match the running copy, including the real chat route, workspace and scroll fix.
- Desktop bottom-arrow measurement: 700 samples over 3.93 seconds stayed at `scrollTop=701.875`. At actual CSS width 375px, reopening the saved chat and activating the bottom arrow each produced 500 stable samples over approximately 2.6 seconds at `scrollTop=1051.25`, with no horizontal document overflow. Page Up continued to scroll away and reveal the bottom arrow. These are browser checks on the local candidate, not a claim that the reported production jitter was reproduced identically.
- Logs, measurements and screenshots are under ignored `.work/chat-restore-oct23/`. Production has not been redeployed; the local candidate remains available for user verification.
