"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[lucian-app-error]", error.digest ?? "client-render-error");
  }, [error.digest]);

  return (
    <section className="flex min-h-full items-center justify-center p-6" role="alert">
      <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-surface p-6 text-center shadow-pop">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-fg">This module could not finish loading</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Your workspace data has not been removed. Retry the module, or return home if the problem continues.
        </p>
        {error.digest && <p className="mt-2 font-mono text-[10px] text-fg-faint">Reference: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={retry} className="focus-ring themed inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-[var(--accent-fg)]">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
          <Link href="/" className="focus-ring themed inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-fg hover:bg-hover">
            <Home className="h-4 w-4" aria-hidden="true" /> Home
          </Link>
        </div>
      </div>
    </section>
  );
}
