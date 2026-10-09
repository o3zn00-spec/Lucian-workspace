/** Scheduling for read-only browser refreshes, never financial submissions.
 * Wait after completion, pause hidden/offline tabs, and back off on failures. */
export function startVisiblePolling(task: () => Promise<unknown>, intervalMs: number, initial = true) {
  let stopped = false, running = false, failures = 0, nextAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => document.visibilityState === "visible" && navigator.onLine !== false;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (!stopped && !running && active()) timer = setTimeout(() => void run(), Math.max(0, nextAt - Date.now()));
  };
  const run = async () => {
    if (stopped || running || !active()) return;
    running = true;
    try { await task(); failures = 0; } catch { failures = Math.min(failures + 1, 5); }
    finally {
      running = false;
      nextAt = Date.now() + Math.min(300_000, intervalMs * 2 ** failures);
      schedule();
    }
  };
  const wake = () => { if (active()) schedule(); else clear(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  nextAt = initial ? Date.now() : Date.now() + intervalMs;
  schedule();
  return () => {
    stopped = true; clear();
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", wake);
  };
}
