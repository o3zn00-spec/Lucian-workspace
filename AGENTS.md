# Private LUCIAN development constraints

- Keep all work local and private. No Git push, publication, deployment, public
  release, or remote synchronization without explicit owner instruction.
- The separate project `C:\Users\HP\Lilthe` is out of scope: do not inspect,
  modify, launch, package, or integrate it.
- Do not modify `C:\Users\HP\AppData\Roaming\lucian-workspace\lucian.db`.
- Do not delete original sources, healthy backups or existing build toolchains.
- No AI integration is installed. Do not resurrect archived assistant code or
  treat historical PostgreSQL tables as a future integration implementation.
- Preserve manual trading's owner authorization, exact confirmation, password
  checks, risk limits, emergency stop and historical reservations.
- Normal builds must not migrate databases, bootstrap owners, run trades or
  restore backups. Use separate explicitly configured development databases.
- Keep real credentials, databases, dependencies and generated build/runtime
  outputs outside source deliveries. Only `.env.example` may be archived.
- Use existing Next/React/TypeScript/Zustand/Prisma/Tauri patterns and lockfiles.
- Validate typecheck, lint, consolidation/architecture tests, completed web
  build, desktop host tests and native Rust tests as appropriate.
- Never run the production-host smoke tests while rebuilding `.next`.
- Read `README.md`, `docs/CONSOLIDATION.md` and `docs/VERIFICATION.md` first.

## Owner-agreed restoration scope (2026-10-07)

- Read `docs/RESTORATION_CHECKPOINT.md` before new work and update its progress
  and evidence after each completed item.
- The owner has agreed to restore the universal assistant and model connections
  described there. The earlier blanket AI-removal constraint describes the old
  consolidation scope; it must not cause removal of these agreed capabilities.
- The separate unfinished custom-model project remains excluded. Preserve all
  other security, data-preservation and build constraints above. The checkpoint
  does not authorize real-money trading or unrelated changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
