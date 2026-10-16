"use client";

import { useSearchParams } from "next/navigation";
import { PaperSessionSetup } from "@/components/assistant/paper-session-setup";
import { Suspense } from "react";
import { MarketsFrame } from "@/components/markets/markets-frame";
import { MarketsDeepLinkReceiver } from "@/components/markets/markets-deep-link-receiver";

/**
 * Markets route.
 *
 * Phase 9: reads `?symbol=<SYMBOL>` to deep-link an exact instrument.
 * Suspense-wraps the receiver because it uses useSearchParams().
 */
function RequestedPaperSetup() {
  const params = useSearchParams();
  return params.get("paperSetup") === "1" ? <PaperSessionSetup /> : null;
}

export default function MarketsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={null}>
        <MarketsDeepLinkReceiver />
      </Suspense>
      <Suspense fallback={null}><RequestedPaperSetup /></Suspense>
      <div className="min-h-0 flex-1"><MarketsFrame /></div>
    </div>
  );
}
