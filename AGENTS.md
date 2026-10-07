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