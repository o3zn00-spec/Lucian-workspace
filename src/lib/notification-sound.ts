"use client";

/* LUCIAN — Notification Sound Helper.
 *
 * A lightweight, dependency-free notification sound using the Web Audio
 * API. We synthesize a short two-tone "ping" so we don't need to ship
 * an audio asset. This respects browser autoplay restrictions (the
 * AudioContext is created lazily on the first user-initiated trigger
 * and resumed if suspended).
 *
 * Behavior:
 *   - playNotificationSound() creates / resumes the AudioContext on
 *     first call (must be triggered by a user gesture in some browsers).
 *   - The sound is a 0.18s sine wave at 880Hz then 1320Hz, with a
 *     gentle gain envelope. Quiet and unobtrusive.
 *   - If the AudioContext is blocked (autoplay policy), we silently
 *     no-op — the notification record still lands in the store.
 *   - Never plays more than once per 250ms (debounce) to avoid sound
 *     spam when multiple notifications arrive simultaneously.
 *
 * Consulted by:
 *   - The notification store's `notify()` (after a new notification is
 *     added) — but ONLY when settings.notifications.sound is true AND
 *     settings.notifications.quietMode is false AND
 *     settings.notifications.masterEnabled is true.
 */

let audioCtx: AudioContext | null = null;
let lastPlayedAt = 0;
const MIN_INTERVAL_MS = 250;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Play the notification sound. Safe to call from anywhere — if the
 * browser blocks autoplay, this silently no-ops.
 */
export function playNotificationSound(): void {
  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
  lastPlayedAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume if suspended (autoplay policy).
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {
      /* autoplay blocked — silently ignore */
    });
  }

  try {
    // Two-tone ping: 880Hz → 1320Hz over 180ms.
    const now2 = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now2);
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1320, now2 + 0.09);

    // Gentle gain envelope (0 → 0.18 → 0).
    gain.gain.setValueAtTime(0, now2);
    gain.gain.linearRampToValueAtTime(0.18, now2 + 0.02);
    gain.gain.linearRampToValueAtTime(0.18, now2 + 0.16);
    gain.gain.linearRampToValueAtTime(0, now2 + 0.18);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now2);
    osc1.stop(now2 + 0.09);
    osc2.start(now2 + 0.09);
    osc2.stop(now2 + 0.18);
  } catch {
    /* audio error — silently ignore */
  }
}

/**
 * Unlock the AudioContext on the first user gesture. Browsers require
 * a user-initiated action before audio can play. We attach one-time
 * listeners for common gestures and resume the context.
 *
 * Called once at app boot from the AppShell.
 */
export function primeNotificationSound(): void {
  if (typeof window === "undefined") return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "running") return;

  const unlock = () => {
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        /* ignore */
      });
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}
