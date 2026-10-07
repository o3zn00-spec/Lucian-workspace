# First restoration stability verification

Date: 2026-10-07. Local changes only; no Git push or Vercel deployment.
Canonical scope: [RESTORATION_CHECKPOINT.md](RESTORATION_CHECKPOINT.md).

## Fixed behavior

- Ordinary routes no longer server-render the full-page isolation preparation
  screen. The shell and appearance/sync mounts sit outside the isolation gate.
- Links crossing the DevWorkspace document-security boundary use a direct full
  navigation rather than a client transition followed by a reload. One document
  load remains necessary to change COOP/COEP. Programmatic navigation retains
  the bounded retry fallback. Disabled session storage cannot crash that gate.
- Markets toggles the effective appearance mode and theme together. ThemeProvider
  no longer writes the effective DOM theme directly, which previously left the
  DOM inconsistent with the settings mode. In-memory preferences continue to
  notify React if storage writes fail; storage-event subscriptions stay active
  until the last subscriber leaves.
- Markets instrument-selection and favorite controls are sibling buttons,
  eliminating the observed nested-button React hydration errors. Favorite
  add/remove still works.
- The service worker cache version is advanced. Mutable assets refresh from the
  network; immutable assets retain cache-first behavior; offline static fallbacks
  remain. Development unregisters this app's production service worker.
- BrandMark uses the original gold rising-building emblem via the existing
  canonical `/icon.png`, without adding a duplicate. Its SHA-256 matches the
  original repository's `public/branding/lucian-workspace-icon.png`.
- Sidebar Settings is removed. Settings remains accessible from the top user
  menu, and its breadcrumb label remains correct.

Opening-animation source and footage, original SQL migrations and app icons
were not changed. No custom model installation or financial provider was used.

## Local checks

Used a separate local PostgreSQL development database and disposable local owner
identity. Production credentials/database were not used for diagnosis. No
paid inference or Vercel deployment was invoked.

Passed:

- Production web build and full TypeScript check.
- Full ESLint check and Git whitespace check.
- Five consolidation/source-preservation checks.
- Eleven trading, twelve workspace and fifty-two Vault architecture checks.
- Control audit: 597 controls, 117 explicitly unavailable, zero unguarded direct
  async controls; thirteen source/security audit checks.
- Five new service-worker behavior tests: private/API/write/external bypass,
  mutable refresh, immutable reuse, private/no-store exclusion and offline paths.
- Ten desktop host/lifecycle/packaging tests after the completed web build.
- Browser: all ten themes, eight accents and three appearance modes exercised;
  reload retained preferences; repeated Markets light/dark switching passed.
- Browser: navigation smoke checks reached Home, DevWorkspace, Browser, Markets,
  Investing, Vault, Economy Hub, News, Research, Mindset Library, Chess and Notes.
  DevWorkspace entry and exit, favorite add/remove, and top-menu Settings access
  were specifically exercised. The final production-build navigation/theme
  round trip produced no captured browser error/warning on the fresh test origin.
- Backend header checks retained scoped COOP/COEP on DevWorkspace and omitted
  them on Browser; unauthenticated requests still redirect to login.

Local evidence is outside source in `../../outputs/restoration-*.log` and
`../../outputs/restoration-appearance.jpg`, `restoration-branding.jpg` relative
to the repository root. Earlier diagnosis used port 43181; final checks used
43182 to avoid the stale asset cache observed on the earlier origin.

## Limits and remaining work

The owner's unspecified color-change crash was not reproduced. Verified fixes
address actual appearance inconsistency, invalid markup and navigation/cache
issues; they do not prove every possible theme crash is resolved.

Navigation smoke checks are not full workflow tests. Workspace import/preview,
editing persistence, chart tools, all provider failures, mobile layouts,
cross-device sync, and every recovery path still require targeted coverage.
Storage-denied handling was reviewed in code but not exercised by changing
browser storage permissions. Unsupported-header and programmatic/back-history
navigation fallback cases remain untested interactively.

Readiness audit has zero structural failures and seven expected configuration
warnings when run without deployment secrets. Recovery email and AI/financial
provider connections remain unconfigured. No unattended or funded trading is
certified. Native Rust code was unchanged and native UI was not tested here.

C03 is complete locally. C02 remains in progress for the broader audit; C04-C15
remain tracked separately. This batch has not changed the deployed application.
