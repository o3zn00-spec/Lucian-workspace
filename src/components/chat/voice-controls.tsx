"use client";
import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Square } from "lucide-react";
import { useLilithVoice } from "@/hooks/use-lilith-voice";
import { VoiceConversation, type VoicePhase } from "@/lib/voice/conversation";
import { parseChatInteraction } from "@/lib/chat/interaction";
export function VoiceControls({ value, onChange, onSend, onCancel, busy, conversationId }: { value: string; onChange: (text: string) => void; onSend: (text: string) => Promise<string | undefined>; onCancel: () => void; busy: boolean; conversationId: string | null }) {
  const { supported, listening, startListening, stopListening, speak, stopSpeaking } = useLilithVoice();
  const [phase, setPhase] = useState<VoicePhase>("off"), [error, setError] = useState("");
  const refs = useRef({ onSend, onChange, onCancel });
  useEffect(() => { refs.current = { onSend, onChange, onCancel }; }, [onSend, onChange, onCancel]);
  const session = useRef<VoiceConversation | null>(null);
  const previousConversation = useRef(conversationId);
  useEffect(() => {
    if (previousConversation.current !== null && previousConversation.current !== conversationId) session.current?.stop();
    previousConversation.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    const current = new VoiceConversation({ listen: startListening, stopListening,
      speak: (text, onEnd, onError) => {
        const interaction = parseChatInteraction(text);
        const speech = interaction?.lilthe_ui === "question" ? `${interaction.question} ${interaction.options.join('. ')}` : interaction?.lilthe_ui === "trade_review" ? `${interaction.summary} Review and approve the session on screen.` : text;
        return speak(speech, { onEnd, onError });
      }, stopSpeaking, send: text => refs.current.onSend(text), cancelSend: () => refs.current.onCancel(), transcript: text => refs.current.onChange(text), phase: setPhase, error: setError });
    session.current = current;
    return () => { current.stop(); session.current = null; };
  }, [startListening, stopListening, speak, stopSpeaking]);
  return <div className="flex items-center gap-1">
    <button type="button" title={supported ? "Dictate into the composer" : "Dictation unavailable in this browser"} aria-label="Dictate into the composer" disabled={!supported || busy || phase !== "off"} className="focus-ring rounded-lg p-2 text-fg-muted hover:bg-hover disabled:opacity-40" onClick={() => {
      setError(""); if (listening) { stopListening(); return; }
      const prefix = value.trim(); startListening({ onTranscript: text => onChange([prefix, text].filter(Boolean).join(' ')), onError: setError });
    }}>{listening && phase === "off" ? <Square size={16} /> : <Mic size={16} />}</button>
    <button type="button" title="Browser voice conversation" aria-label={phase === "off" ? "Start voice conversation" : "End voice conversation"} disabled={!supported || (busy && phase === "off")} className={`focus-ring rounded-lg p-2 hover:bg-hover disabled:opacity-40 ${phase === "off" ? "text-fg-muted" : "text-accent"}`} onClick={() => { setError(""); if (phase === "off") session.current?.start(); else session.current?.stop(); }}><AudioLines size={17} /></button>
    {phase !== "off" && <span role="status" className="text-xs capitalize text-fg-muted">{phase}</span>}
    {phase === "speaking" && <button type="button" className="focus-ring rounded px-2 text-xs underline" onClick={() => session.current?.interrupt()}>Interrupt</button>}
    {error && <span role="alert" className="max-w-48 text-xs text-red-400">{error}</span>}
  </div>;
}
