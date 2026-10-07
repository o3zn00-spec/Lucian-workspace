# LUCIAN — private master source

This is the consolidated **LUCIAN product**, not an AI integration checkpoint.
The legacy assistant has been removed. No replacement assistant is connected.

## Source layout

- `app/`: Next.js App Router pages, authenticated server routes, global styles.
- `src/`: LUCIAN UI, workspace editors/runtime, stores, chess, markets, research,
  notifications, authentication, security and finance modules.
- `prisma/`: PostgreSQL schema and the complete original nine-migration chain.
- `public/`: web assets, guardian authentication footage/held frame, branding,
  manifest and privacy-safe static-asset service worker.
- `desktop/`: standalone loopback Next host, lifecycle, local runtime staging,
  integrity checks, bootstrap/recovery pages and tests. **Node only; no AI service.**
- `src-tauri/`: native Rust/Tauri shell, local-runtime resolver, tray/shortcut/
  window-state source, Cargo lockfile and desktop icon assets.
- `scripts/`: structural/security tests and existing gated maintenance tools.
- `docs/`: consolidation decisions, exact provenance and verification results.

The master intentionally excludes `node_modules`, `.next`, Rust `target`,
generated schemas, staged runtime bundles, Git metadata, real environment files,
database files and compiled executables. Recreate these locally when needed.

## Local development

Use Node.js 22 (validated with 22.23.2) and npm. In Windows PowerShell, use
`npm.cmd` to avoid the machine's restriction on unsigned PowerShell scripts.

```powershell
cd C:\Users\HP\LUCIAN-PRIVATE-CONSOLIDATION\LUCIAN-master
npm.cmd ci
npm.cmd run dev
```

The dev and standard production servers bind to `127.0.0.1` by default.
For authenticated development, copy `.env.example` to `.env.local` and configure
a **separate development PostgreSQL database**, signing/encryption keys and an
owner identity. No credentials from the preserved backup were copied here.
Without configuration the UI can show login, but protected account operations
fail closed. Do not connect this source to production while testing cleanup.

Prisma client generation is part of installation/build and does not migrate a
database. Database migration/bootstrap/restore commands are **not** part of the
normal build and must only be run intentionally against an approved dev target.
The live `lucian.db` is SQLite; this product's existing authoritative backend is
PostgreSQL. Consolidation did not import, edit or migrate that SQLite database.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:consolidation
npm.cmd run test:architecture
npm.cmd run audit:phase13
npm.cmd run build
npm.cmd run test:desktop
```

`test:desktop` requires a completed production web build and **no DATABASE_URL**.
Do not run it concurrently with `build`; Next rebuilds its output directory.
The tests create only a temporary signing key, not an owner/account/session.

## Desktop development

The restored source uses Tauri 2, Rust/MSVC and Windows WebView2. The machine's
existing toolchains remain at `C:\BuildTools\LUCIAN` and
`C:\BuildTools\LUCIAN-Rust`; no toolchain was removed or replaced.

```powershell
npm.cmd run build
npm.cmd run desktop:host
# Alternatively, with Rust/MSVC available:
npm.cmd run desktop:dev
```

The native launcher sets `LUCIAN_DESKTOP_NODE` and uses the existing Rust
installation if found. If MSVC discovery fails, run desktop development from an
x64 developer command prompt initialized with
`C:\BuildTools\LUCIAN\VC\Auxiliary\Build\vcvars64.bat`.
The native shell expects its own loopback host on port **43180** and refuses to
adopt or kill an unrelated process occupying that port.

`npm.cmd run desktop:stage` verifies and stages a local web runtime under
`.desktop-cache`. `desktop/assemble-runtime.mjs <web-stage>` can assemble Node
and web stages; it fetches the matching Node license and never uploads source.
Stages/distributions remain **releaseReady=false**, and Tauri installer bundling
is disabled. This is a development source deliverable, not an approved installer.
Do not mark runtime stages approved without addressing the tracing warnings and
completing a separate installation/security review.

## Legacy removal and data safety

Assistant UI, voice, providers/models/prompts, memory runtime, AI routes,
coding-agent tools, AI trade execution, AI settings and the desktop service
coupling were removed, not renamed into a supposed future integration.

Historical PostgreSQL chat/memory tables are mapped as `Archived*` models only
for authenticated account data export. There are no chat/memory write APIs,
assistant consumers or hydration paths. The offline schema diff is empty.
`TradingAgentProfile` remains the original physical/shared risk-policy mapping
used by manual trading and emergency-stop controls, not an agent service.
Existing financial records/reservations are not discarded; automated historical
intents are rejected by the manual confirmation path.

Do not push, publish, deploy or add a remote until the owner explicitly changes
the privacy requirement. See `docs/CONSOLIDATION.md` and `docs/VERIFICATION.md`.