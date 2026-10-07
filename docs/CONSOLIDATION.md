# Consolidation decisions

## Inputs and isolation

1. Main product: `C:\Users\HP\OneDrive\Documents\GitHub\Lucian-workspace-v2`.
2. Preserved source/assets:
   `C:\Users\HP\SAFE-PROJECT-BACKUPS-2026-09-21\LUCIAN-PRESERVED-DESKTOP-AND-ASSETS`.
3. Working/delivered master:
   `C:\Users\HP\LUCIAN-PRIVATE-CONSOLIDATION\LUCIAN-master`.

Neither input was edited. The master has no `.git` history/remotes and is outside
OneDrive. No upload, push, deployment, publication or release was performed.
Package download/Prisma generation and cached Rust builds were local dependency
operations, not synchronization of LUCIAN source.

Both inputs were inventoried and SHA-256 compared before merging. They contain
512 non-Git/non-generated-input file entries: 416 V2 and 96 preserved files.
There are **no overlapping relative paths** between the inputs. This is not a
merge of two complete competing web repositories: V2 is the product baseline;
the preservation set supplies missing desktop/support/assets. Every input's
final disposition is recorded in `SOURCE-PROVENANCE.json`.

## Phase 13 additions retained (31 files)

- `desktop/host.mjs`, `host.test.mjs`: retained standalone Next hosting and
  strict loopback/host/origin controls; removed all old assistant spawning,
  Python dependencies, backend health/token handshakes and live-project paths.
- `desktop/lifecycle.mjs`, `lifecycle.test.mjs`: ownership of startup/shutdown
  promises, including close-during-startup protection.
- `desktop/launch.mjs`: native development entry point; the previously missing
  referenced `@tauri-apps/cli` dependency was restored to the package/lockfile.
- `desktop/package-runtime.mjs`, `package-runtime.test.mjs`: traced web runtime
  staging, file checksums and rejection of secrets/databases/path escapes;
  removed the old AI service from the required file set.
- `desktop/assemble-runtime.mjs`, `assemble-runtime.test.mjs`: checksummed stage
  assembly; now only web + Node, never Python/assistant stages. Unapproved by
  default. Integrity/path/overwrite regressions retained.
- `desktop/bootstrap/index.html`, `recovery.html`: native startup/recovery
  pages without old assistant installation claims.
- `desktop/fixtures/runtime/package.json`, `server.cjs`: small genuine Node
  project fixture for future WebContainer compatibility tests (not app runtime).
- `src-tauri/Cargo.toml`, `Cargo.lock`, `build.rs`, `tauri.conf.json`,
  `src/main.rs`, `src/runtime.rs`: complete native shell/config/build source.
  Main/resolver no longer require an AI component or its data directory.
- `src-tauri/icons/32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`,
  `icon.png`, `icon.ico`, `icon.icns`: desktop icon/bundle source, including
  platform formats for continued desktop development.
- `public/auth/guardian-entrance.mp4`, `guardian-hold.webp`,
  `src/components/auth/cinematic-auth.module.css`: actual preserved login
  assets/styles. V2's active layout was rewired to the clean first 3.33 seconds,
  held frame and real form, with skip/replay/reduced-motion/error/stall fallback.
- `public/branding/lucian-guardian.svg`: used by the shared `BrandMark`.
- `src/components/layout/IsolationBoundary.tsx`: mounted in the app layout so
  DevWorkspace COOP/COEP document changes use full navigation, not only client
  route transitions. Retains one-retry behavior without an infinite reload.

The preservation handoff describes changes whose implementation files were not
present in that preservation set. No claim is made that those missing changes
(for example full Bybit reconciliation) were recovered from documentation.

## Removed/excluded legacy AI

- Floating assistant layer/orb/motion/settings/chat, all module assistant
  buttons/context handoffs, voice hook, shared conversations, chat UI/attachments,
  model providers/configs/persona prompts and behavioral settings.
- Economic assistant page/routes/store, provider probes, market chat, generic
  old AI chat routes, workspace coding agent/tools/memory/persistence.
- AI cloud chat/memory routes, migration payloads, hydration/reset bindings and
  chat sync helpers. Pending retry processing rejects removed endpoints.
- AI search/navigation/PWA shortcuts, notifications/settings/credential entries,
  assistant capital/permission controls and stale UI claims.
- Old chat's parallel live spot execution and command parser/tests. Manual
  `/api/trading/orders` now uses the existing confirmed terminal path, retaining
  owner/password/exact-confirmation checks. Automated historical intents cannot
  be submitted through manual confirmation.
- Python/assistant desktop wrappers, packaging/probes/tests and integration
  tests that would access the separate live assistant project.
- No AI SDK/model dependency existed in V2's lockfile; provider calls were
  implemented directly. Those callers/configurations were removed.

This is removal, not a rename/rebrand of the old AI. There is no connected
replacement, scheduler, model service, agent runtime or hidden placeholder chat.
The current `C:\Users\HP\Lilthe` project was never opened, read, modified,
started or packaged during this task.

## Investigated names/data that must not be deleted blindly

- The database's original `TradingAgentProfile` also owns non-AI manual-terminal
  risk limits and emergency stop. Its table/schema remains for those features;
  unused legacy permission/allocation columns are inert compatibility data,
  not an assistant implementation.
- Historical chat/message/memory tables remain mapped to `Archived*` Prisma
  models for account data export only. Removing the tables/migration history
  could destroy user records or break existing database compatibility. An offline
  V2-to-master schema diff returns **empty migration**. No schema migration ran.
- Original SQL migration files remain byte-identical. Historical naming in SQL
  is migration history, not active AI code.
- The local alpha-beta chess engine and puzzles remain: they are chess product
  functionality, not the removed assistant/model integration.
- Generic code import/export/converter support and project environment-key
  detection remain, including descriptions of external tools/APIs a user's own
  imported project may use. These do not call an assistant.

## Duplicates / obsolete / generated / private files

- Excluded `.git`, build/dependency outputs, generated Tauri schemas, compiled
  `bin/lucian-desktop.exe`, unused mobile/store icon exports and private
  `.env.local.backup`. The environment backup's values were never read/copied.
- Excluded old phase/audit/deployment documents and fixed-commit baseline script
  that could not describe the consolidated product accurately; replaced by these
  documents and reproducible source-preservation/removal tests.
- Removed superseded WebGL login renderer and its now-unused `three` /
  `@types/three` dependency tree after the actual preserved footage was wired.
- Removed byte-identical public copies of the canonical app icon and Apple icon;
  all references now use `/icon.png` and `/apple-icon.png`.
- Kept visually/functionally distinct logo/favicon/native formats rather than
  treating all similar-looking assets as duplicate junk.
- Recreated `.env.example` from non-AI runtime/maintenance requirements with empty
  secrets, sandbox defaults and disabled live locks; never imported private envs.
- Tightened service-worker behavior: no private/auth page caching, no old AI
  shortcut, no API/write/external interception; only appropriate static responses
  are cached. Source privacy requires more than an npm `private` flag.

Build outputs were retained outside the master under the consolidation's
verification-output area, not confused with source or existing toolchains.
No existing backup or original build toolchain was deleted.

## Remaining scope

See `VERIFICATION.md`. Successful compile/structural tests are not a claim that
all pre-existing modules, providers, live money or authenticated flows are
production-ready. Future assistant integration is a separate owner-approved task.