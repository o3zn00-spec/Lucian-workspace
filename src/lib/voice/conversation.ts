export type VoicePhase = "off" | "listening" | "thinking" | "speaking";
type Callbacks = { onTranscript: (text: string, final: boolean) => void; onEnd: () => void; onError: (message: string) => void };
type IO = {
  listen: (callbacks: Callbacks) => boolean; stopListening: () => void;
  speak: (text: string, onEnd: () => void, onError: () => void) => boolean; stopSpeaking: () => void;
  send: (text: string) => Promise<string | undefined>; cancelSend: () => void;
  transcript: (text: string) => void; phase: (phase: VoicePhase) => void; error: (message: string) => void;
};
/** Explicit, foreground, bounded conversational speech. No background microphone. */
export class VoiceConversation {
  private generation = 0;
  private current: VoicePhase = "off";
  private pending: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  constructor(private io: IO) {}
  private phase(value: VoicePhase) { this.current = value; this.io.phase(value); }
  start() {
    this.stop(); const generation = this.generation;
    this.deadline = setTimeout(() => this.fail("Voice conversation ended after fifteen minutes. Start it again to continue."), 15 * 60 * 1000);
    this.listen(generation);
  }
  stop() {
    ++this.generation; clearTimeout(this.pending); clearTimeout(this.deadline);
    this.pending = undefined; this.io.stopListening(); this.io.stopSpeaking(); this.io.cancelSend(); this.phase("off");
  }
  interrupt() {
    if (this.current !== "speaking") return;
    const generation = ++this.generation; this.io.stopSpeaking(); this.listen(generation);
  }
  private fail(message: string) { this.stop(); this.io.error(message); }
  private listen(generation: number) {
    if (generation !== this.generation) return;
    this.phase("listening");
    const started = this.io.listen({
      onTranscript: (text, final) => {
        if (generation !== this.generation || this.current !== "listening") return;
        clearTimeout(this.pending); this.pending = undefined; this.io.transcript(text);
        if (final && text.trim()) this.pending = setTimeout(() => { this.pending = undefined; void this.send(text.trim(), generation); }, 1200);
      },
      onEnd: () => {
        if (generation === this.generation && this.current === "listening" && !this.pending) this.fail("Microphone listening ended. Start voice conversation again to continue.");
      },
      onError: message => { if (generation === this.generation) this.fail(message); },
    });
    if (!started && generation === this.generation && this.current !== "off") this.fail("Microphone could not start. Check browser voice support and permissions.");
  }
  private async send(text: string, generation: number) {
    if (generation !== this.generation || this.current !== "listening") return;
    this.phase("thinking"); this.io.stopListening();
    let reply: string | undefined;
    try { reply = await this.io.send(text); } catch { if (generation === this.generation) this.fail("Voice request failed. Your conversation is retained; no automatic retry was made."); return; }
    if (generation !== this.generation) return;
    if (!reply?.trim()) { this.fail("No spoken response was received. Review the chat error and restart voice when ready."); return; }
    this.phase("speaking");
    if (!this.io.speak(reply, () => { if (generation === this.generation && this.current === "speaking") this.listen(generation); }, () => { if (generation === this.generation) this.fail("Spoken playback failed. The text reply remains in your conversation."); })) this.fail("Spoken playback is unavailable. The text reply remains in your conversation.");
  }
}
