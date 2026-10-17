"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldCheck, X } from "lucide-react";
import { AutonomousTradingCard } from "./autonomous-trading-card";
export function SessionTools() {
  const [open,setOpen]=useState(false);
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener("lucian:session-controls",show);const timer=new URLSearchParams(window.location.search).get("sessionReview")==="1"?window.setTimeout(show,0):undefined;return()=>{window.removeEventListener("lucian:session-controls",show);window.clearTimeout(timer);};},[]);
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button type="button" className="focus-ring ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-hover hover:text-fg"><ShieldCheck size={14} />Sessions</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[130] bg-black/40" /><Dialog.Content className="themed fixed inset-y-3 right-3 z-[131] w-[min(48rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border border-line bg-surface text-fg shadow-pop"><div className="flex items-center justify-between border-b border-line-muted px-4 py-3"><div><Dialog.Title className="text-sm font-medium">Session activity and controls</Dialog.Title><Dialog.Description className="mt-1 text-xs text-fg-muted">Review ongoing work, reports and session permissions.</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="Close session controls" className="focus-ring rounded p-1 text-fg-muted hover:bg-hover"><X size={16} /></button></Dialog.Close></div><AutonomousTradingCard /></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
