export default function ModuleLoading() {
  return (
    <div className="themed flex h-full min-h-[320px] items-center justify-center bg-canvas text-fg">
      <div className="w-full max-w-sm px-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto h-8 w-8 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 p-2">
          <div className="h-full w-full animate-pulse rounded-full bg-[var(--accent)]" />
        </div>
        <p className="mt-3 text-[12px] font-medium text-fg">Opening module…</p>
        <p className="mt-1 text-[10px] text-fg-faint">Your current workspace remains available while this view prepares.</p>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="lucian-navigation-progress h-full bg-[var(--accent)]" />
        </div>
      </div>
    </div>
  );
}
