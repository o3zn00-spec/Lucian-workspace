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
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback((options: {
    language?: string;
    onTranscript: (transcript: string, final: boolean) => void;
    onError?: (message: string) => void;
  }) => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      options.onError?.("Voice recognition is not supported by this browser.");
      return false;
    }
    recognitionRef.current?.abort();
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.language ?? navigator.language ?? "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      let final = true;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
        if (!event.results[index].isFinal) final = false;
      }
      if (transcript.trim()) options.onTranscript(transcript.trim(), final);
    };
    recognition.onerror = (event) => {
      setListening(false);
      options.onError?.(`Voice recognition stopped: ${event.error}.`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { options.onError?.("Microphone could not start. Check browser permissions."); return false; }
    setListening(true);
    return true;
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, options?: { rate?: number; volume?: number; onEnd?: () => void }) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[`#*_>|]/g, " "));
    utterance.rate = options?.rate ?? 1;
    utterance.volume = options?.volume ?? 0.8;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => { setSpeaking(false); options?.onEnd?.(); };
    utterance.onerror = () => { setSpeaking(false); options?.onEnd?.(); };
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  return { supported, listening, speaking, startListening, stopListening, speak, stopSpeaking };
}
