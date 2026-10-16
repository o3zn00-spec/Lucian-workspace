"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Square } from "lucide-react";
import { RealtimeVoice } from "@/lib/voice/realtime";
export function NaturalVoice({ onSend, onCancel, disabled, contextKey, onActive }: { onSend: (text: string) => Promise<string | undefined>; onCancel: () => void; disabled: boolean; contextKey: string; onActive?: (active: boolean) => void }) {
  const callbacks = useRef({ onSend, onCancel });
  useEffect(() => { callbacks.current = { onSend, onCancel }; }, [onSend, onCancel]);
  const [active, setActive] = useState(false), [error, setError] = useState("");
  const session = useRef<RealtimeVoice | null>(null);
  const previous = useRef(contextKey);
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  useEffect(() => { if (previous.current !== "new" && previous.current !== contextKey) session.current?.stop(); previous.current = contextKey; }, [contextKey]);
  useEffect(() => {
    const voice = new RealtimeVoice(text => callbacks.current.onSend(text), setActive, setError, () => callbacks.current.onCancel()); session.current = voice;
    const hide = () => { if (document.hidden) voice.stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { voice.stop(); document.removeEventListener("visibilitychange", hide); };
  }, []);
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <button type="button" disabled={disabled && !active} aria-label={active ? "End natural voice" : "Start natural voice"} title="AI-generated voice · OpenAI audio credits apply · five-minute session" className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-fg-muted hover:bg-hover disabled:opacity-40" onClick={() => { setError(""); if (active) session.current?.stop(); else void session.current?.start(); }}>{active ? <Square size={14} /> : <Headphones size={14} />}{active ? "End voice" : "Natural voice"}</button>
    {active && <span role="status" className="text-fg-muted">AI voice · microphone on · OpenAI credits</span>}
    {error && <span role="alert" className="max-w-sm text-red-400">{error}</span>}
  </div>;
}
