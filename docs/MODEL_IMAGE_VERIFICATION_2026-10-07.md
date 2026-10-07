# Model and image delivery verification — 2026-10-07

Scope: C05/C06 only. No financial execution, paid inference or custom model
installation. Existing layout, opening animation and gold logo preserved.

## Implemented

Shared conversation windows forward the latest bounded image batch. Main chat,
module panel and regeneration use the same wire format. Gemini inlineData,
OpenAI-compatible image_url and Anthropic base64 source blocks receive actual
pixels. Preparation failures retain draft/attachments and release the busy state.
Known text-only models reject images; custom/unknown capabilities are disclosed.

Connection checks use GET model catalogs, including Anthropic; they no longer
create a paid minimal reply. Selected-model listing is distinct from inference.
Catalog pages are bounded, deduplicated and never follow external pagination URLs.
Gemini keys travel in headers rather than URLs. Provider calls have timeouts;
multiple text response parts are combined and empty responses fail visibly.

## Evidence

- Production build and lint/typecheck pass.
- Architecture/security, five consolidation and ten desktop tests pass.
- audit:phase13: zero failures. Seven environment warnings arise from running
  the static audit without private deployment variables; they are not a claim
  that production configuration was revalidated by that static audit.
- scripts/model-image-tests.mjs intercepts fetch and replaces credential access:
  six adapter payloads, image blocks, reasoning, read-only checks, history bounds,
  catalog pagination/deduplication. No external network or real credentials.
- scripts/restored-agent-tests.ts uses only localhost/disposable database:
  image request acceptance, invalid URLs/data/types/roles/count rejection,
  unsupported model rejection, catalog/model listing status, plus existing
  auth/origin/isolation, revision, memory and sync regressions.
- Browser: local screenshot attachment, send, regenerate, reload and capability
  disclosure. The mock acknowledges receiving one image after reload/retry.
  Unreadable-file check retains draft/attachment and enables Send. Preparation
  errors omit the unrelated history Retry action. No semantic vision claim.
- Proof: outputs/lilthe-image-delivery-verified.jpg (outside repository).

## Limits and next gate

1280-pixel compressed previews, 100k characters each; eight images in the most
recent image-bearing turn. Reattach older batches and crop small text. GIFs use
one frame. Other binaries are metadata only. Image signatures are checked;
provider decoding still determines whether the full format can be consumed.

Production publication/checks recorded separately after release. Actual model
screenshot accuracy, account access and custom endpoint compatibility remain
unverified until the selected real provider is exercised within an agreed budget.

Provider format references: [Gemini](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding),
[Anthropic](https://platform.claude.com/docs/en/build-with-claude/vision),
[OpenAI](https://developers.openai.com/api/docs/guides/images-vision).
