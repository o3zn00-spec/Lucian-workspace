"use client";

import { Suspense } from "react";
import { MarketsFrame } from "@/components/markets/markets-frame";
import { MarketsDeepLinkReceiver } from "@/components/markets/markets-deep-link-receiver";

/**
 * Markets route.
 *
 * Phase 9: reads `?symbol=<SYMBOL>` to deep-link an exact instrument.
 * Suspense-wraps the receiver because it uses useSearchParams().
 */
export default function MarketsPage() {
  return (
    <>
      <Suspense fallback={null}>
        <MarketsDeepLinkReceiver />
      </Suspense>
      <MarketsFrame />
    </>
  );
}
