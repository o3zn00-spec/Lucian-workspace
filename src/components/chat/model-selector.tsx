"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Cpu } from "lucide-react";
import { ComposerPopover } from "./composer-popover";
import { PROVIDERS } from "@/store/economic-agent-connection";
import { useSharedAIConfig, getProviderInfo, type InterfaceId, type ProviderId } from "@/store/shared-ai-config";
import { supportsReasoning, type ReasoningEffort } from "@/lib/agent/model-capabilities";

export function ModelSelector({interfaceId="economic-agent"}:{interfaceId?:InterfaceId}) {
  const shared=useSharedAIConfig();
  const {provider,model}=shared.resolve(interfaceId);
  const setProvider=(provider:ProviderId)=>{if(shared.overrides[interfaceId])shared.setOverride(interfaceId,{provider,model:getProviderInfo(provider).defaultModel});else {shared.setGlobalProvider(provider);shared.setGlobalModel(getProviderInfo(provider).defaultModel);}};
  const setModel=(model:string)=>{if(shared.overrides[interfaceId])shared.setOverride(interfaceId,{provider,model});else shared.setGlobalModel(model);};
  const effort = useSharedAIConfig(s => s.reasoningEffort);
  const setEffort = useSharedAIConfig(s => s.setReasoningEffort);
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const anchor = useRef<HTMLDivElement>(null);
  const reasoning = supportsReasoning(provider, model);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!anchor.current?.contains(event.target as Node) && !(event.target as Element).closest?.("[data-composer-popover]")) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/ai/models?provider=${provider}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Unable to load models. You can enter an exact model ID.");
      setModels(result.models);
      setStatus(result.configured ? "Available models from your provider" : "Connect this provider in Settings → Connections to discover your models.");
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, [open, provider]);
  return <div ref={anchor} className="relative">
    <button type="button" aria-label={`Choose model and reasoning, current model ${model}`} aria-expanded={open} className="focus-ring flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs text-fg-muted hover:bg-hover" onClick={() => { setOpen(!open); setChoosing(false); }}><Cpu className="h-3.5 w-3.5"/><span className="max-w-48 truncate">{model || "Select model"}</span>{reasoning && <span className="capitalize">{effort}</span>}<ChevronDown className="h-3 w-3"/></button>
    {open && <ComposerPopover className="w-80 p-3" onClose={() => setOpen(false)}>
      <button type="button" onClick={() => setChoosing(!choosing)} className="focus-ring flex w-full items-center justify-between rounded-xl p-2 text-sm hover:bg-hover"><span className="truncate">{model || "Select model"}</span><ChevronRight className="h-4 w-4"/></button>
      {choosing ? <div className="mt-3 space-y-3">
        <label className="block text-xs text-fg-muted">Provider<select aria-label="AI provider" value={provider} onChange={e => { setProvider(e.target.value as typeof provider); setQuery(""); setModels([]); }} className="mt-1 w-full rounded-lg bg-surface p-2 text-sm">{PROVIDERS.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <input aria-label="Search or enter model ID" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search models or enter an ID" className="focus-ring w-full rounded-lg bg-surface p-2 text-sm"/>
        <div role="listbox" aria-label="Available models" className="max-h-60 overflow-y-auto">{Array.from(new Set([model, ...models])).filter(id => id && id.toLowerCase().includes(query.toLowerCase())).map(id => <button role="option" aria-label={`Select model ${id}`} aria-selected={id === model} type="button" key={id} onClick={() => { setModel(id); setChoosing(false); }} className="focus-ring flex w-full items-center justify-between rounded-lg p-2 text-left text-sm hover:bg-hover"><span className="truncate">{id}</span>{id === model && <Check className="h-4 w-4"/>}</button>)}</div>
        {query.trim() && !models.includes(query.trim()) && <button type="button" className="focus-ring rounded-lg p-2 text-sm hover:bg-hover" onClick={() => { setModel(query.trim()); setChoosing(false); }}>Use model ID: {query.trim()}</button>}
        <p className="text-xs text-fg-muted" role="status">{status}</p>
      </div> : <fieldset className="mt-3" disabled={!reasoning}><legend className="text-xs text-fg-muted">Reasoning effort</legend><div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1">{(["low", "medium", "high"] as ReasoningEffort[]).map(level => <button type="button" key={level} aria-label={`Set reasoning effort to ${level}`} aria-pressed={level === effort} onClick={() => setEffort(level)} className={`focus-ring rounded-full px-2 py-2 text-xs capitalize disabled:opacity-40 ${level === effort && reasoning ? "bg-accent text-on-accent" : "hover:bg-hover"}`}>{level}</button>)}</div>{!reasoning && <p className="mt-2 text-xs text-fg-muted">This model does not expose these reasoning controls. Choose a supported reasoning model.</p>}</fieldset>}
    </ComposerPopover>}
  </div>;
}
