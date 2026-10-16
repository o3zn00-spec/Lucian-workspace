import { parseChatInteraction } from "@/lib/chat/interaction";
/** Foreground WebRTC transport. The shared chat remains the only task executor. */
export class RealtimeVoice {
  private peer?: RTCPeerConnection;
  private stream?: MediaStream;
  private audio?: HTMLAudioElement;
  private channel?: RTCDataChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private generation = 0;
  private working = false;
  private calls = new Set<string>();
  constructor(private send: (text: string) => Promise<string | undefined>, private state: (active: boolean) => void, private error: (message: string) => void, private cancel: () => void) {}
  stop() {
    const wasWorking = this.working;
    ++this.generation; clearTimeout(this.timer); this.abort?.abort(); this.channel?.close(); this.peer?.close();
    this.stream?.getTracks().forEach(t => t.stop()); if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.peer = undefined; this.stream = undefined; this.channel = undefined; this.audio = undefined; this.working = false; this.calls.clear(); if (wasWorking) this.cancel(); this.state(false);
  }
  async start() {
    this.stop(); const generation = this.generation; this.abort = new AbortController(); this.state(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream; const peer = new RTCPeerConnection(); this.peer = peer;
      const audio = new Audio(); audio.autoplay = true; this.audio = audio;
      peer.ontrack = e => { if (generation !== this.generation) return; audio.srcObject = e.streams[0]; void audio.play().catch(() => { if (generation === this.generation) { this.stop(); this.error("Audio playback was blocked. Restart voice after allowing playback."); } }); };
      peer.onconnectionstatechange = () => { if (generation === this.generation && ["failed", "disconnected"].includes(peer.connectionState)) { this.stop(); this.error("Voice disconnected. Your chat is retained; restart when ready."); } };
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events"); this.channel = channel;
      channel.onmessage = event => { void this.handle(event.data, generation); };
      channel.onclose = () => { if (generation === this.generation) { this.stop(); this.error("Voice connection closed. Restart to continue."); } };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (generation !== this.generation) return;
      const response = await fetch("/api/assistant/voice", { method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp, signal: this.abort.signal });
      if (!response.ok) { const data = await response.json(); throw Error(data.error || "Voice connection failed."); }
      const sdp = await response.text(); if (generation !== this.generation) return;
      await peer.setRemoteDescription({ type: "answer", sdp });
      this.timer = setTimeout(() => { this.stop(); this.error("Voice ended after five minutes. Start again to continue."); }, 300000);
    } catch (e) { if (generation === this.generation) { this.stop(); this.error(e instanceof Error ? e.message : "Microphone unavailable."); } }
  }
  private async handle(raw: string, generation: number) {
    if (generation !== this.generation) return;
    let event; try { event = JSON.parse(raw); } catch { return; }
    if (event.type === "error") { this.stop(); this.error("The voice provider reported an error. No automatic retry was made."); return; }
    if (event.type !== "response.function_call_arguments.done" || event.name !== "ask_lilthe" || typeof event.call_id !== "string" || this.calls.has(event.call_id)) return;
    if (this.working || this.calls.size >= 20) { this.stop(); this.error("Voice request limit reached. Continue in chat or restart voice."); return; }
    let args; try { args = JSON.parse(event.arguments); } catch { return; }
    if (!args || Object.keys(args).length !== 1 || typeof args.text !== "string" || !args.text.trim() || args.text.length > 4000) { this.stop(); this.error("Invalid voice request. Please continue in chat."); return; }
    this.calls.add(event.call_id); this.working = true;
    try {
      const answer = await this.send(args.text);
      if (generation !== this.generation) return;
      const ui = parseChatInteraction(answer ?? "");
      const output = ui?.lilthe_ui === "question" ? `${ui.question} Options: ${ui.options.join(', ')}` : ui?.lilthe_ui === "trade_review" ? `${ui.summary} Review and approve on screen.` : ui?.lilthe_ui === "chart" ? ui.summary : answer || "No answer was confirmed. Check the chat.";
      this.channel?.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: output.slice(0, 12000) } }));
      this.channel?.send(JSON.stringify({ type: "response.create" }));
    } catch { if (generation === this.generation) { this.stop(); this.error("Lilthe could not complete the request. Check the chat before retrying."); } }
    finally { if (generation === this.generation) this.working = false; }
  }
}
