"use client";
import { useState } from "react";
import type { ChatInteraction } from "@/lib/chat/interaction";
import type { InterfaceId } from "@/store/shared-ai-config";
import { TradingApproval } from "./trading-approval";
export function InteractionCard({ interaction, onChoose, interfaceId, disabled }: { interaction: ChatInteraction; onChoose?: (text: string) => void; interfaceId: InterfaceId; disabled: boolean }) {
  const [choice, setChoice] = useState<string | null>(null);
  if (interaction.lilthe_ui === "trade_review") return <><p className="leading-relaxed">{interaction.summary}</p><TradingApproval interfaceId={interfaceId} disabled={disabled} /></>;
  return <div className="my-2 space-y-3"><p className="font-medium leading-relaxed">{interaction.question}</p><div className="flex flex-wrap gap-2">{interaction.options.map(option => <button type="button" key={option} aria-pressed={choice === option} disabled={disabled || !onChoose || choice !== null} onClick={() => { setChoice(option); onChoose?.(`${interaction.question}\n${option}`); }} className={`focus-ring rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${choice === option ? "border-fg bg-fg text-canvas" : "border-line bg-surface hover:bg-hover disabled:opacity-50"}`}>{option}</button>)}</div><p className="text-xs text-fg-muted">{choice ? `Selected: ${choice}` : "Choose an option, or type your own answer below."}</p></div>;
}
