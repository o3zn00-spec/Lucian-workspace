"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { isFinal: boolean; length: number; [index: number]: RecognitionAlternative }
interface RecognitionResultList { length: number; [index: number]: RecognitionResult }
interface RecognitionEvent extends Event { resultIndex: number; results: RecognitionResultList }
interface RecognitionErrorEvent extends Event { error: string }
interface RecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

/** Browser-native speech; recognition processing depends on the browser/vendor. */
export function useLilithVoice() {
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { recognitionRef.current = null; }
    setListening(false);
  }, []);

  const startListening = useCallback((options: {
    language?: string;
    onTranscript: (transcript: string, final: boolean) => void;
    onError?: (message: string) => void;
    onEnd?: () => void;
  }) => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      options.onError?.("Voice recognition is not supported by this browser.");
      return false;
    }
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    try { previous?.abort(); } catch { /* Some browsers throw after recognition has already ended. */ }
    utteranceRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    let recognition: RecognitionInstance;
    try { recognition = new Constructor(); } catch {
      setListening(false);
      options.onError?.("Microphone could not start. Check browser permissions.");
      return false;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.language ?? navigator.language ?? "en-US";
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      let transcript = "";
      let final = true;
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
        if (!event.results[index].isFinal) final = false;
      }
      if (transcript.trim()) options.onTranscript(transcript.trim(), final);
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      options.onError?.(`Voice recognition stopped: ${event.error}.`);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      options.onEnd?.();
    };
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { recognitionRef.current = null; setListening(false); options.onError?.("Microphone could not start. Check browser permissions."); return false; }
    setListening(true);
    return true;
  }, []);

  const stopSpeaking = useCallback(() => {
    utteranceRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, options?: { rate?: number; volume?: number; onEnd?: () => void; onError?: () => void }) => {
    if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined" || !text.trim()) return false;
    // Do not transcribe the assistant's own speaker output into the next message.
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.abort(); } catch { /* Already stopped. */ }
    setListening(false);
    utteranceRef.current = null;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[`#*_>|]/g, " "));
    utterance.rate = options?.rate ?? 1;
    utterance.volume = options?.volume ?? 0.8;
    utteranceRef.current = utterance;
    utterance.onstart = () => { if (utteranceRef.current === utterance) setSpeaking(true); };
    const end = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
      options?.onEnd?.();
    };
    utterance.onend = end;
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null; setSpeaking(false);
      if (options?.onError) options.onError(); else options?.onEnd?.();
    };
    try { window.speechSynthesis.speak(utterance); } catch {
      utteranceRef.current = null;
      setSpeaking(false);
      return false;
    }
    return true;
  }, []);

  useEffect(() => () => {
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    utteranceRef.current = null;
    try { previous?.abort(); } catch { /* Cleanup must finish even when recognition has ended. */ }
    window.speechSynthesis?.cancel();
  }, []);

  return { supported, listening, speaking, startListening, stopListening, speak, stopSpeaking };
}
