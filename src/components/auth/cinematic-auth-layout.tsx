"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCcw, SkipForward } from "lucide-react";
import styles from "./cinematic-auth.module.css";

interface AuthLayoutContextValue {
  onSuccess: () => void;
  onPasswordFocusChange: (focused: boolean) => void;
}
const AuthLayoutContext = createContext<AuthLayoutContextValue>({
  onSuccess: () => {},
  onPasswordFocusChange: () => {},
});
export function useAuthLayout(): AuthLayoutContextValue {
  return useContext(AuthLayoutContext);
}

const SESSION_KEY = "lucian-auth-seen";
const CLEAN_ENTRANCE_SECONDS = 3.33;

/** Preserved guardian footage followed by its clean held frame and real form. */
export function CinematicAuthLayout({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"playing" | "ready">("ready");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [success, setSuccess] = useState(false);
  const finish = useCallback(() => {
    videoRef.current?.pause();
    setPhase("ready");
    try { sessionStorage.setItem(SESSION_KEY, "true"); } catch { /* unavailable */ }
  }, []);

  const replay = useCallback(() => {
    const video = videoRef.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    video.currentTime = 0;
    setPhase("playing");
    void video.play().catch(finish);
  }, [finish]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const initialize = window.setTimeout(() => {
      setReducedMotion(media.matches);
      let seen = false;
      try { seen = sessionStorage.getItem(SESSION_KEY) === "true"; } catch { /* unavailable */ }
      if (!media.matches && !seen) replay();
    }, 0);
    const onMotionChange = () => {
      setReducedMotion(media.matches);
      if (media.matches) finish();
    };
    media.addEventListener("change", onMotionChange);
    return () => {
      window.clearTimeout(initialize);
      media.removeEventListener("change", onMotionChange);
    };
  }, [finish, replay]);

  useEffect(() => {
    if (phase !== "playing") return;
    // Video failure/stalling must never make authentication inaccessible.
    const timeout = window.setTimeout(finish, 5000);
    const check = window.setInterval(() => {
      if ((videoRef.current?.currentTime ?? 0) >= CLEAN_ENTRANCE_SECONDS) finish();
    }, 30);
    return () => { window.clearTimeout(timeout); window.clearInterval(check); };
  }, [phase, finish]);

  return (
    <AuthLayoutContext.Provider value={{ onSuccess: () => setSuccess(true), onPasswordFocusChange: () => {} }}>
      <div className={styles.stage} data-phase={phase} data-reduced-motion={reducedMotion} data-success={success}>
        <div className={styles.backdrop} aria-hidden="true">
          <div className={styles.hold} />
          <video ref={videoRef} className={styles.video} src="/auth/guardian-entrance.mp4"
            muted playsInline preload="metadata" onError={finish} onEnded={finish}
            onTimeUpdate={() => { if ((videoRef.current?.currentTime ?? 0) >= CLEAN_ENTRANCE_SECONDS) finish(); }} />
        </div>
        <div className={styles.formRegion}>
          <div className={styles.materialization} aria-hidden={phase !== "ready"} inert={phase !== "ready"}>{children}</div>
        </div>
        {!reducedMotion && <div className={styles.controls}>
          <button type="button" onClick={phase === "playing" ? finish : replay}>
            {phase === "playing" ? <SkipForward className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {phase === "playing" ? "Skip entrance" : "Replay entrance"}
          </button>
        </div>}
        <div className={styles.success} aria-hidden="true" />
      </div>
    </AuthLayoutContext.Provider>
  );
}