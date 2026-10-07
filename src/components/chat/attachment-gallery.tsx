"use client";
/* eslint-disable @next/next/no-img-element -- Local attachment previews are data/blob URLs. */
import * as Dialog from "@radix-ui/react-dialog";
import { Paperclip, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
export interface AttachmentPreview { id: string; name: string; url?: string }
export function AttachmentGallery({ items, onRemove }: { items: AttachmentPreview[]; onRemove?: (id: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const images = items.filter(item => item.url);
  const index = images.findIndex(item => item.id === selected);
  const active = images[index];
  return <><div aria-label="Attachments" className="flex gap-2 overflow-x-auto px-1 py-2">
    {items.map(item => <div key={item.id} className="relative shrink-0 rounded-xl bg-surface-2">
      {item.url ? <button type="button" aria-label={`Preview ${item.name}`} onClick={() => setSelected(item.id)} className="focus-ring block rounded-xl"><img src={item.url} alt={item.name} className="h-24 w-32 rounded-xl object-cover"/></button> : <span className="inline-flex max-w-48 items-center gap-2 p-3 text-xs"><Paperclip className="h-4 w-4"/><span className="truncate">{item.name}</span></span>}
      {onRemove && <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)} className="focus-ring absolute right-1 top-1 rounded-full bg-surface p-1 text-fg shadow"><X className="h-3 w-3"/></button>}
    </div>)}
  </div><Dialog.Root open={Boolean(active)} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm attachment-preview-overlay"/><Dialog.Content className="attachment-preview-content themed fixed inset-4 z-[201] flex flex-col items-center justify-center rounded-2xl bg-overlay p-5 text-fg shadow-pop sm:inset-10">
    <Dialog.Title className="mb-3 max-w-full truncate text-sm">{active?.name}</Dialog.Title><Dialog.Description className="sr-only">Attachment preview. Use previous and next to browse screenshots. Press Escape to close.</Dialog.Description>
    {active && <img src={active.url} alt={active.name} className="min-h-0 max-h-[75dvh] max-w-full flex-1 object-contain"/>}
    <Dialog.Close aria-label="Close preview" className="focus-ring absolute right-3 top-3 rounded-full bg-surface p-2"><X className="h-5 w-5"/></Dialog.Close>
    {images.length > 1 && <div className="mt-4 flex items-center gap-5"><button type="button" aria-label="Previous screenshot" disabled={index <= 0} onClick={() => setSelected(images[index-1].id)} className="focus-ring rounded-full p-2 disabled:opacity-30"><ChevronLeft/></button><span className="text-xs">{index+1} / {images.length}</span><button type="button" aria-label="Next screenshot" disabled={index >= images.length-1} onClick={() => setSelected(images[index+1].id)} className="focus-ring rounded-full p-2 disabled:opacity-30"><ChevronRight/></button></div>}
  </Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
