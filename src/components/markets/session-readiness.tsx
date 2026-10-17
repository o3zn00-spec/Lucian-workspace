"use client";
import Link from "next/link";
import type { SessionReadiness } from "@/lib/bybit/session-readiness-policy";
export function SessionReadinessNotice({value}:{value:SessionReadiness}) {
  return <div role="status" className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
    <p className="font-medium">{value.title}</p>
    <p className="whitespace-pre-wrap leading-relaxed">{value.message}</p>
    <p className="text-fg-muted">{value.nextAction}</p>
    <Link href="/markets?sessionReview=1" className="focus-ring rounded-lg border border-line px-3 py-2" onClick={event=>{if(window.location.pathname==="/markets"){event.preventDefault();window.dispatchEvent(new Event("lucian:session-controls"));}}}>Open session controls</Link>
  </div>;
}
