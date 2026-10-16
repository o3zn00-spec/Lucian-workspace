"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Newspaper, X } from "lucide-react";
import { IntelligencePanel } from "./intelligence-panel";
export function MobileResearch() {
  return <Dialog.Root><Dialog.Trigger asChild><button type="button" className="focus-ring ml-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-hover xl:hidden"><Newspaper size={14} />News</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[130] bg-black/40"/><Dialog.Content className="themed fixed inset-y-3 right-3 z-[131] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-pop"><div className="flex items-center justify-between border-b border-line px-3 py-2"><div><Dialog.Title className="text-sm font-medium">Market research</Dialog.Title><Dialog.Description className="text-xs text-fg-muted">Current external publisher feeds</Dialog.Description></div><Dialog.Close asChild><button aria-label="Close market research" className="focus-ring rounded p-2"><X size={16}/></button></Dialog.Close></div><div className="flex min-h-0 flex-1 [&>aside]:!w-full"><IntelligencePanel/></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
