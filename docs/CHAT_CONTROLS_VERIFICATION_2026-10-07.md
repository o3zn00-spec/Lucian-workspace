# Lilthe chat controls and Settings verification — 2026-10-07

## Owner request and changes

Preserve the original Lilthe main page, sidebar, orb, logo and opening animation. Fix the saved-conversation warning and composer-clipped menus; arrange Settings clearly; add provider-discovered models, actual Low/Medium/High effort controls, horizontal attachment thumbnails and enlarged previews.

- Context/add-context and model menus render in viewport-clamped body portals above the composer when space permits. Escape/outside click close them.
- Model selection has separate model/provider/search and effort views. Model discovery is an authenticated server request using server-only keys. Unsupported models explicitly disable effort controls. OpenAI/OpenRouter supported reasoning families receive reasoning_effort and completion-token limits without unsupported temperature parameters.
- Raster screenshot thumbnails open an enlarged dialog with close, previous/next and reduced-motion-aware expansion. Sent previews survive saved-conversation reload. Up to eight attachments per send; compressed previews are bounded to 100,000 characters each. These previews do not yet make the provider understand binary images: existing provider context remains text/file metadata. Provider vision is still pending.
- Settings now has grouped left navigation, search, Back to app, readable rows and a constrained content column. Existing settings and disabled/unavailable states remain intact.
- Sync batches new message inserts, skips unchanged database updates, uses an explicit transaction timeout, sends changed messages with retained IDs rather than repeatedly resending all image history, retries transient writes, preserves local appended messages and the active conversation on recovery, and supports reconnect/retry. Genuine remaining failures stay visible in a compact notification; they are not silently hidden.

## Evidence

- Production build (including TypeScript), ESLint, phase 13 architecture/security/control/readiness audit passed. Static control audit: 664 controls, 129 explicitly unavailable, zero unguarded direct async controls. This is a structural audit, not proof that every provider-dependent feature works.
- Consolidation: five tests pass. Desktop host: ten tests pass. No native Rust changes.
- Dedicated local PostgreSQL integration tests pass: owner isolation, same-origin enforcement, conflicts, rename/pin/archive, deduplication/soft deletion, memory CRUD, authenticated model discovery and invalid-provider/effort rejection, image metadata round-trip, 100-message batch and delta retention, and mock chat transport.
- Provider-payload test intercepts fetch and confirms all three effort values reach o3 requests; gpt-4o-mini omits reasoning_effort. No real inference was called.
- Browser: context overlay has BODY parent, stays within viewport and opens outside composer. Manual model selection, High effort selected state, mock-discovered model, screenshot thumbnails/enlargement/next/close, two sent turns and retained screenshots after reload pass; no sync warning in the local run.
- Browser: all twelve Settings sections render; search finds voice/orb settings and opens them; Back to app works. Espresso/Ocean Blue and Light/Dark changes return to Midnight Gray/Lucian Gold without a crash.
- Browser: all thirteen sidebar destinations navigate with no observed error boundary or browser warning/error. This does not certify every nested workflow or third-party service.

## Limits and release

The production screenshot warning was observed, but the older deployment did not record its underlying database exception. The changes address demonstrated timeout/payload/retry failure modes; production recovery must be checked after publication. Vercel connector runtime-log access returned 403, so dashboard inspection is used where available. Deployment environment/recovery readiness reports seven expected missing-variable warnings when checked without secret environment files; SMTP recovery is still unconfigured.

Real provider accounts, model availability/effort support outside the supported families, provider vision, voice round-trip, executable universal tools, autonomous trading and risk/exchange/session execution, Investing canvas and broad nested-workflow acceptance remain checkpoint work. No paid provider or financial API calls, migration, owner reset, or real trades were performed for these fixes. The existing server hydration limits remain 100 conversations and 500 messages per conversation; pagination is future work.

Publication: pending GitHub-first release and production verification.
