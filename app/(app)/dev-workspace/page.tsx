"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DevWorkspaceModule } from "@/components/devspace/dev-workspace";
import { DevWorkspaceDeepLinkReceiver } from "@/components/devspace/dev-workspace-deep-link-receiver";
import { cn } from "@/lib/utils";
import { X, FileText } from "lucide-react";

/**
 * DevWorkspace route — renders the full DevWorkspace subsystem.
 *
 * Phase 8: also reads ?handoff=<id> to receive cross-module handoffs
 * (e.g. prototype briefs from Economy Hub).
 *
 * Phase 9: also reads ?project=<id> and ?file=<path> to deep-link an
 * exact project + file. The receiver lives in its own component
 * (DevWorkspaceDeepLinkReceiver) and uses the real IndexedDB project
 * store — there is no localStorage snapshot fallback.
 */
export default function DevWorkspacePage() {
  return (
    <>
      <Suspense fallback={null}>
        <DevWorkspaceHandoffReceiver />
      </Suspense>
      <Suspense fallback={null}>
        <DevWorkspaceDeepLinkReceiver />
      </Suspense>
      <DevWorkspaceModule />
    </>
  );
}

/** Phase 8: handoff receiver for DevWorkspace.
 *  Reads ?handoff=<id>, consumes the handoff, and displays the prototype
 *  brief / source context as an overlay banner. */
function DevWorkspaceHandoffReceiver() {
  const searchParams = useSearchParams();
  const [brief, setBrief] = useState<{
    title: string;
    content: string;
    source: string;
  } | null>(null);
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    const handoffId = searchParams.get("handoff");
    if (!handoffId) return;

    const { consumeHandoff } = require("@/lib/cross-module-bridge");
    const handoff = consumeHandoff(handoffId);
    if (!handoff) return;

    consumedRef.current = true;

    // Extract the brief from static context. Defer setState to a
    // microtask to avoid synchronous setState in the effect body.
    if (handoff.staticContext.length > 0) {
      const ctx = handoff.staticContext[0];
      const id = window.setTimeout(() => {
        setBrief({
          title: ctx.label,
          content: ctx.content,
          source: handoff.sourceModule,
        });
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [searchParams]);

  if (!brief) return null;

  return (
    <div className="fixed right-4 top-16 z-50 max-w-sm rounded-lg border border-[var(--accent)]/30 bg-surface shadow-pop">
      <div className="flex items-center justify-between border-b border-line-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="text-[12px] font-semibold text-fg">{brief.title}</span>
        </div>
        <button type="button" aria-label="Dismiss project brief" onClick={() => setBrief(null)} className="text-fg-faint hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-3">
        <p className="text-[10px] text-fg-faint mb-1">Source: {brief.source}</p>
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-fg-muted">
          {brief.content}
        </pre>
        <p className="mt-2 text-[9px] text-fg-faint">
          Use this brief to start a new project or guide your work.
          No prototype was automatically built.
        </p>
      </div>
    </div>
  );
}
