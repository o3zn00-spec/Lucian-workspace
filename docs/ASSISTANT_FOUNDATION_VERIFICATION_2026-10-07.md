# Assistant foundation verification — 2026-10-07

Status: locally verified foundation; C04 and C06 remain in progress. No production
migration, Git push or deployment was performed in this batch. No model inference,
exchange execution or paid service was invoked.

## Implemented behavior

`src/lib/assistant/contracts.ts` defines the app-owned Lilthe identity, maintained
module context and honest capability availability. `service.ts` and
`app/api/assistant/route.ts` persist owner-scoped conversation/message state,
model preferences, explicit memory and tool activity with server authentication,
origin checking, input validation and idempotent message retries. A different
body reusing a message request identifier receives 409. Foreign conversations
cannot be read, activated, modified or used for tools, including ID collisions.

Only reading the capability map and returning a validated navigation destination
are available utilities. The latter does not navigate the browser. Records,
research, coding changes, trading and voice are unavailable and denied/audited.

`assistant-foundation.tsx` mounts one state provider in AppShell, with a Home
conversation panel and compact expandable module panel. It resets state when the
signed-in owner changes and identifies the current module. The UI explicitly
labels itself a foundation preview and saves messages without fake model replies.
Account export includes new assistant data while preserving historical exports.

## Data preservation

Migration `20261007140000_assistant_foundation` adds five tables with indexes and
foreign keys. It was applied explicitly only to localhost database
`lucian_restoration_dev_20261007`. The nine prior migration files are unchanged;
archived models remain untouched. Normal builds never apply this migration.
Production requires a separate migration step before serving the new handlers.

Historical chat/memory is not automatically copied into the new tables. Future
owner-requested import must retain archived sources, preserve identifiers and
provenance, verify owner mappings and content/counts, and make repeated import
idempotent. This batch neither installs nor depends on the unfinished custom model.

## Verification performed

- Production Next build completed; lint and TypeScript checks passed.
- Real local API integration passed against both development and production
  servers: anonymous rejection, foreign-owner isolation, create/message retries,
  conflict rejection, persisted preferences preserving identity/messages, explicit
  memory, unavailable-tool auditing, context validation, body/origin rejection,
  and account export ownership. Test fixtures are scoped and cleaned up.
- Browser: created/saved a conversation in Home, recovered it in Investing and
  DevWorkspace through required full-page navigation and reload. Production
  Investing panel displayed the same message and current Investing context;
  warning/error console was empty in this check.
- Consolidation, architecture/security audit and ten desktop-host checks passed.
  Architecture checks are not live exchange/database financial tests. Production
  readiness reports seven expected environment warnings without deployment
  variables; zero failures. Native Rust was not changed or tested here.
- Evidence logs are outside source under `../../outputs/assistant-foundation-*`.
  Screenshot: `../../outputs/assistant-foundation-investing.jpg`.

## Remaining acceptance work

Provider credentials/catalog validation, inference/streaming, final Codex-reference
chat layout, attachment upload, reasoning/model and permission controls, voice,
resizing/full-view and mobile usability remain open. Explicit memory has a server
API but no finished user management interface. Selected record references do not
confer read permission; real record adapters and coding tools remain unimplemented.
An unsent draft does not survive full-page navigation; saved messages do.

No unattended runner, research engine, session-policy enforcement or autonomous
trading has been implemented by this foundation. Financial execution stays blocked.
The entire app and the original unspecified theme crash are not proven fixed by
these targeted checks. Continue the broader C02 audit as capabilities are restored.

## Subsequent owner layout correction

The Home chat card was rejected by the owner after these foundation checks. The
latest design restores `/economic-agent` as the dedicated Lilthe workspace and
restores sidebar grouping from the supplied original screenshot. Home keeps its
dashboard and compact shared chat. Earlier Home screenshots document a superseded
interim layout; they are not final design approval. Verification of the correction
is recorded in the restoration checkpoint.
