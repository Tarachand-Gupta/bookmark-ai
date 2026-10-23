# Ask AI: library access and chat UX

The assistant can search the signed-in account's bookmarks, saved sessions and enabled live tabs on every turn. Selected bookmarks and uploaded files add evidence and focus; they do not disable library tools. A user's explicit request to use only particular sources is followed in the answer, without changing tenant permissions.

`listContext` inspects attached bookmarks only. Its empty result must never be interpreted as an empty library. The turn retains its checked source snapshot in conversation history, including unavailable sources; regeneration reuses that snapshot. All searches and read-only queries still run against the authenticated tenant's database. URL fetching retains the engine's SSRF protections.

## Chat presentation

- Default-library messages omit the old “Context: Your library” block.
- Attached bookmarks have an expandable source chip, with checked titles/links and unavailable-source explanations. The composer identifies library access separately.
- Tool activity shows its name, status and description. Results, SQL tables and technical payloads are collapsed initially; expand the row to inspect results, then “Technical details” for raw input/output.
- Reasoning is optional to inspect, including while streaming. Completed replies offer Copy and the latest reply offers Retry.
- The included-AI allowance is a compact expandable summary. Its full weekly usage meter remains available.
- Chat preserves the existing account-isolated drafts, uploads, history, stop control, limits and failure recovery. Suggestion rotation respects reduced motion.

## Included model configuration

The default primary is OpenRouter `z-ai/glm-5.3-flash`, with Google `gemini-3.8-flash` as the pre-content failure fallback. The user's complete own-provider configuration still takes precedence in own-key mode. Weekly included-AI metering remains unchanged.

To opt into Cloudflare, configure these **server-only** variables in Vercel → this project's Settings → Environment Variables → Production, and in the ignored local environment file used by your build variant:

```dotenv
INCLUDED_AI_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=<32-character account ID>
CLOUDFLARE_API_TOKEN=<token with Workers AI access>
```

Do not prefix them with `NEXT_PUBLIC_`. Do not commit values. Redeploy after adding them. The production build's local configuration uses `.env.supabase.production.local`; ordinary local development reads root `.env`.

The adapter uses `@cf/zai-org/glm-5.3-flash` at `https://api.cloudflare.com/client/v4/accounts/<account-id>/ai/v1/chat/completions`, with tool calling and low reasoning effort. It does not require a Cloudflare Worker or another SDK. Keep `GEMINI_API_KEY` for fallback and existing embedding/categorization features. Missing Cloudflare credentials use Gemini if configured; they do not silently route the explicitly selected primary back to OpenRouter. With no usable model, chat reports unavailable.

Cloudflare requires paid Workers access or supported prepaid AI Gateway credits for this model. Check account access before switching production; the adapter's mocked protocol test is not evidence of live Cloudflare credentials or billing access.

Official references: [GLM 5.3 Flash](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/), [OpenAI-compatible API](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/).
