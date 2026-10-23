# AI chat regression and visual checks

Run against a disposable tenant/fixture first. Real provider sign-in, model calls and production checks are separate evidence. Never copy fixture authentication or simulated failures into a production source snapshot.

## Order and dependencies

1. **Contracts**: run web typechecking and the web Vitest suite. `chat-context-route.test.ts` exercises the actual route with a local tenant database and mocked model transport. It verifies library/attached/unavailable context, searches outside the attachment, saved sessions, live sharing off, read-only SQL, auth denial and URL safety. Model-protocol tests exercise the Cloudflare request shape with mocked HTTP; fallback tests cover pre-content failure behavior.
2. **Desktop visual check**: open an empty chat; inspect the compact allowance, suggestions, composer and history. Ask for category counts with the configured real model. Expect a self-contained answer and collapsed activity, then expand results and technical details. Check Copy and Retry separately.
3. **Mobile widths**: verify actual CSS viewport widths (browser zoom can change them). Check 320, 375 and 768 pixels plus desktop. There must be no horizontal overflow, inaccessible send/close buttons, or dialog clipping. Review attached-source picker, selected chip and source preview. Check both light and dark through the product's appearance controls.
4. **Attachments + retrieval**: attach one saved bookmark, ask for the whole library's count and the attached title. Verify the full count, not one. Attach a synthetic text/image file, verify preview/removal and model interpretation, then ask for a related library lookup. A missing/deleted bookmark should not disable the rest of the library.
5. **State lifecycle**: type a draft and attach a file; close and reopen, switch conversations and return. Draft/files must persist while mounted; a reload may require file reattachment and must say so. Stop a response, send another message, expand/reopen history, and retry a failed response without losing a newly typed draft. Use a fixture-only simulated provider failure if the real provider is healthy.
6. **Release**: build from the actual product source, with Supabase production configuration and no fixture routes/auth files. Deploy candidate, verify signed-out health/auth boundaries, promote, then perform one signed-in production chat with the real provider. Check deployment identity and browser behavior rather than treating HTTP 200 alone as a pass.

## Evidence from this pass

- Full web suite: 984 tests pass across 91 files. Three additional SSR disclosure tests pass separately; the final focused run passes 69 overlapping checks. Typechecking and the production Next.js build pass.
- Isolated fixture at `.work/ai-chat-oct23/web-fixture`, preview port 3102; existing port 3000 was not replaced.
- Real provider run returned 12 bookmarks in two categories. With one bookmark attached, a second real reply still counted all 12 and named the attached bookmark.
- OpenRouter's configured provider policy rejected the primary request; Gemini fallback completed both real replies. This proves fallback, not working primary availability.
- Real image upload was correctly described (red, green and blue vertical stripes) while the same reply counted all 12 library bookmarks. Image preview and Escape dismissal passed.
- Retry reused the original attached source and retained an unsent draft/file. Reload produced an explicit reattachment notice; the Reattach button restored the file and enabled sending. Stop, history search, unavailable sources, error recovery and copy passed.
- Visual checks passed in light/dark at actual CSS widths 320, 375, 767, 769 and 1600. Both sides of the tablet breakpoint were checked. Expanded chat uses a centered reading column.
- Production source `17d88e634234`, deployment `dpl_rdJDk5kkBaroQtAUpnLj8CdamaFd`, promoted to `https://www.bookmark-ai.cloud`. Health/sign-in return 200; signed-out `/api/me` returns 401. The original AI-content-generation question retrieved saved sessions and matching tab records and produced linked results with collapsed activity.
- Screenshots and command logs are under `.work/ai-chat-oct23/` (ignored, not product assets).

## Alternatives / harness notes

Use the current harness's browser controls or another permitted real-browser harness. BrowserOS is preferred when installed, but unavailable tools should not block a supported browser fallback. Use accessible names for controls; native coordinate clicks can land on an overlay or the page under a popup. Remove development indicator overlays only inside the test fixture when they cover controls.

Synthetic transcript seeding is useful for error, unavailable-source and tool-card layout checks. Label it synthetic; it does not prove model intelligence, real provider authentication or external-service availability. Never use the owner's physical phone for automated QA. Keep test input synthetic, avoid changing account credentials, and leave unrelated concurrent agents' files and servers alone.
