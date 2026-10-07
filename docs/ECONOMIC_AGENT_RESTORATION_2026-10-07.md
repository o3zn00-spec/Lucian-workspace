# Original Economic Agent restoration — 2026-10-07

Source: L-Builds/Lucian-workspace-v2, reference commit
`74e089e8509360db1b3befbcb4fc47cd279eaa59`. The owner explicitly requested the
original Economic Agent, including placement, movement, orb and its functions.
The simplified interim page is superseded by the original page and components,
renamed Lilthe for display. This is local work; no push/deployment was performed.

## Restored source and integration

| Area | Restored implementation | Verification |
| --- | --- | --- |
| Main page | Original 1,368-line Economic Agent page: welcome view, separate conversation column, grouped history/search, conversation menu, context selection and composer | Built; existing history loaded; new conversation and chat round trip exercised |
| Conversation actions | Original rename, pin, archive, duplicate, delete and history selection code | Rename/pin/archive and revision conflict API tests; deletion is now recoverable server-side soft deletion; duplicate UI not separately exercised |
| Messages/composer | Original shared chat components: messages, copy/regenerate/retry/error/stop controls, attachment picker and provider/model controls | Mock reply rendered; original text attachment-only send exercised; all control edge cases not independently verified |
| Context | Original context providers, cross-module bridge and context resolver; original context menu and module context | Picker rendered available BTCUSD context; floating panel showed current module. Context payloads are client snapshots, not server-verified exchange balances or data freshness |
| Orb | Original layered SVG, breathing glow, particles, rotating rings, statuses, motion, dragging and floating chat layer; original CSS animation block | Open/close and shared transcript verified; dragged and persisted position recovered after reload; reduced-motion code restored, not every preset separately checked |
| Floating panel | Original chat panel, history/model controls, attachments, microphone, transcript and speak/interrupt wiring | Same messages/replies as main view; main send and orb no longer overlap |
| Orb settings | Original identity, visibility, position/lock, size, animation/glow, voice and response-style settings | Settings rendered and dark appearance applied without crash; all setting combinations remain broader audit scope |
| AI/model settings | Original shared configuration, Economic Agent compatibility store, provider status/test UI, behavior controls and explicit memory UI | Source restored; compatibility store now follows shared model changes; status probe and local mock adapter verified |
| Providers | Original Gemini/OpenAI/Anthropic/OpenRouter/DeepSeek/custom adapters and connection interface; server-only encrypted key definitions | Custom OpenAI-compatible adapter exercised only against loopback fixture; no paid-provider calls; selected real models/capabilities not verified |
| Memory | Existing new owner-scoped memory table connected to restored explicit memory UI and chat recall | Owner-scoped CRUD tested; old automatic heuristic extraction is excluded pending agreed memory/permission review |
| Voice | Original browser speech-recognition/synthesis hook and panel controls | Code/build verified; startup exceptions handled. No microphone capture or actual speech round trip tested; recognition processing depends on browser/vendor, not guaranteed on-device |

## Storage and security adaptations

The original browser UI now hydrates from the new AssistantConversation/Message
records, including messages saved by the preceding foundation. It does not write
to archived historical ChatConversation/ChatMessage tables. Stable message IDs
prevent duplicate inserts; server versions reject stale updates. Pin/archive and
summary metadata are stored with each conversation. Deleted conversations and
removed message revisions are retained server-side, hidden from active history.
Account export continues including existing archives and new assistant records.

New owner-scoped browser cache keys preserve offline local work and leave original
unscoped historical keys untouched. Automatic historical import is not performed.
The sync bridge serializes writes and skips unchanged conversations. Storage errors
show retry and do not replace the rest of the app with an assistant loading gate.
Pending cache/conflict recovery across multiple devices needs further C04/C06
verification; browser closure does not constitute an autonomous background runner.

Additive migration `20261007160000_restored_agent_metadata` was applied only to
`lucian_restoration_dev_20261007` on localhost. It adds conversation metadata,
soft-deletion timestamp and message metadata; the preceding ten migrations remain
unchanged. Production still needs both restoration migrations as a separate step.
Normal builds do not migrate or bootstrap.

Chat, model status/test, memory and restored sync handlers authenticate the owner.
Mutations check origin and validate input. Provider errors returned by chat are
sanitized. Uploaded client transcripts are owner-saved records, not proof of
server-authorized tool execution. Original manual trading safeguards are unchanged.

The old shared-chat direct trading parser was not copied into execution: it called
older live-trading functions outside the newly agreed session-policy design.
Financial execution stays unavailable through the assistant until C08-C12 are
implemented and verified. The unfinished custom-model installation stays excluded.
Original adapters remain model APIs, not evidence of an autonomous research,
coding-tool or financial execution engine.

Original response streaming is a shared chunked transport after an adapter returns
a complete answer; it is not native provider token streaming. Binary attachments
retain labels/metadata in the original implementation; images/PDFs are not parsed
or forwarded as vision inputs. Model selection uses maintained/manual entries,
not automatic model discovery. These limitations remain C05/C06 acceptance work.

## Verification evidence

- Production build, TypeScript, lint, five consolidation checks, architecture/
  control/security audit and ten desktop-host tests passed. No Rust source changed.
- Both foundation and restored integration suites passed against the production
  local server, including owner isolation, retry conflicts, revision checks,
  pin/archive/rename state, origin rejection, soft deletion, memory CRUD, provider
  status and a local mock-provider chat round trip.
- Browser exercised existing history, text/attachment sends and displayed fixture
  replies, original context menu, orb panel/shared transcript, drag/persistence,
  reload, settings and dark appearance. Checked browser warnings/errors were empty.
- No inference credits, exchange transactions, production database changes or
  Vercel deployments were used for testing. Native microphone/provider operation,
  background trading, full mobile coverage and multi-device conflict resolution
  are not verified by these tests.
- Logs: `../../outputs/original-agent-*.log`. Final original-layout screenshot:
  `../../outputs/lilthe-original-restored.jpg`.

C04/C05/C06/C07/C13 remain in progress for their broader agreed acceptance scope.
Restoring original source behavior does not mark the entire universal assistant
or unattended trading system complete.
