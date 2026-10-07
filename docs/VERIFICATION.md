# Verification results and limits

Verification ran locally on Windows with Node 22.23.2, npm 10.9.8,
Next 16.3.3, React 19.2.6, Prisma 6.19.3, TypeScript 5.9.3,
Rust/Cargo 1.98.1 and Tauri CLI 2.12.1.

## Passed

| Check | Result |
| --- | --- |
| V2 lockfile installation | `npm.cmd ci --ignore-scripts --no-audit --no-fund` succeeded; 534 packages initially |
| Required desktop CLI / obsolete login dependencies | Added the referenced Tauri CLI; removed unused Three.js/types; npm lock regenerated |
| Dependency graph | `npm.cmd ls --depth=0`: exit 0; no missing/invalid top-level dependencies |
| Prisma generation | Client generated locally; no database connection/migration |
| Physical schema compatibility | Offline V2-to-master `prisma migrate diff --script`: **empty migration**, exit 0 |
| TypeScript | Full `tsc --noEmit`: exit 0 |
| ESLint | Full `eslint .`: exit 0 |
| Production web build | Next/Turbopack compiled, typechecked and generated 20/20 static pages; exit 0 |
| Consolidation/source-preservation tests | 5 passed: product anchors, AI absence, every alias import, archival schema/manual orders, actual asset wiring/privacy |
| Desktop lifecycle/packaging/assembly unit tests | 7 passed |
| Standalone desktop host integration | 3 passed: strict host/port, occupied-port preservation, actual production Next startup/auth rejection/assets/shutdown/restart |
| Native Tauri/Rust tests | `cargo test --locked --offline`: 4 passed |
| Native Windows debug executable build | `cargo build --locked --offline`: exit 0 |
| Manual trading architecture | 11 checks passed |
| Workspace/navigation architecture | 12 checks passed |
| Vault architecture | 52 passed, 0 failed; no live database/provider operations |
| Source/security audit | 13 checks passed |
| Interactive-control audit | 597 controls; 117 explicitly unavailable; 0 unguarded direct async controls |
| Production-readiness structural checks | 0 failures; 7 expected missing production-configuration warnings |
| Actual local web runtime staging | 4,057 files; 351,561,736 bytes; manifest/checksum verification succeeded; unapproved |
| Actual staged-runtime startup | Spawned only the staged LUCIAN Node host; login/guardian/icon assets served, unconfigured trading denied, graceful stop passed |

Durable command logs/exit records are outside the final source, under
`C:\Users\HP\LUCIAN-PRIVATE-CONSOLIDATION\audit`.
Generated dependencies/builds/stages are kept outside the delivered master in
the verification-output area. They are not part of the source ZIP.

## Safety verification

- Both supplied original sources were read-only; final input hashes/provenance
  account for every original input entry and retained/changed/excluded file.
- The original V2 Git worktree remained clean; no push/remote write/deployment.
- `C:\Users\HP\Lilthe` was never read, edited, started or packaged. In particular,
  old preserved desktop tests/services referencing it were not executed.
- Live `C:\Users\HP\AppData\Roaming\lucian-workspace\lucian.db` remained
  unchanged in size, modification time and SHA-256. Its private runtime
  fingerprint is omitted from the public source; local audit evidence is retained
  outside the repository.
- No existing backups/toolchains were deleted or replaced.
- All nine original migration SQL files are unchanged. No migration, account
  bootstrap, restoration, trade, withdrawal or financial-provider request ran.
- Final ZIP membership and SHA-256 of every file are compared against the exact
  clean master. The source manifest intentionally excludes itself from its own
  file-hash list; ZIP comparison includes the manifest.

## Warnings and deliberately unverified behavior

1. **No live/production certification.** Authentication submission, valid owner
   session, account recovery email/Google flow, authenticated end-to-end module
   workflows, database persistence and cross-device sync were not tested against
   a database. Production credentials were not copied or used.
2. **Live money not tested.** Bybit balance/fill reconciliation, timeout/unknown
   submissions, bank/broker adapters, real ledger/webhooks/withdrawals and risk
   enforcement against actual provider data remain unverified. Pre-existing
   provider stubs and incomplete order reconciliation are not fixed merely by
   consolidation. Keep live trading/withdrawals disabled.
3. **Native UI not interactively inspected.** Rust build/tests and the real
   loopback host passed, but tray, shortcut, WebView2 rendering, hide/reopen,
   window geometry, native menu and shutdown through the window close button were
   not manually exercised. Mobile/browser visual regressions and WebContainer
   execution in WebView2 were not interactively tested.
4. **Cinematic rendering not visually certified.** Assets are wired and served;
   the component has reduced-motion/skip/error/stall handling. Actual browser
   video playback/layout/transition timing and mobile form appearance remain
   unverified. Footage is the preserved 1916x1080 source, not a new native-4K scene.
5. **Release runtime not approved.** Web staging emitted 133 dependency-tracing
   warnings. Its checksum verification passed but tracing completeness alone
   cannot certify every native/provider/production path. Windows installer,
   release-mode resource packaging, code signing and installation on a clean
   machine are unverified. `bundle.active=false` and `releaseReady=false` remain.
6. **Toolchain warning.** The existing MSVC initializer printed a missing
   `vswhere.exe` warning but initialized x64 successfully and native build/tests
   passed. Debug build also warns that the release-only `packaged` resolver is
   unused in debug mode. Existing toolchains were not altered to suppress either.
7. **Dependency age/security.** The locked ESLint version reports that it is no
   longer supported. This task did not blindly upgrade the framework/toolchain
   or run a full vulnerability-remediation project. No security guarantee is
   inferred from successful lint/build.
8. **Archived data deliberately retained.** `Archived*` PostgreSQL models and
   original SQL history are export-only compatibility, not a remaining AI
   implementation. Physical shared trading risk-policy naming is likewise
   necessary for non-AI trading. No private runtime database/history is shipped.
9. Earlier smoke runs failed when started concurrently with a rebuild (Next
   clears `.next`). Another smoke identified missing public exclusions for the
   restored auth assets; those exact asset exclusions were fixed. Final smoke
   tests were rerun after a completed build and passed. Do not parallelize build
   and production-host smoke tests against the same output directory.

The source is clean and buildable for continued private LUCIAN development;
it is not a claim that all historical product features are finished.