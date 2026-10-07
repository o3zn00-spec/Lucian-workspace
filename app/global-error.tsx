"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[lucian-global-error]", error.digest ?? "root-render-error");
  }, [error.digest]);

  return (
    <html lang="en">
      <head><title>LUCIAN recovery</title></head>
      <body style={{ margin: 0, background: "#0e1013", color: "#f3f4f6", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div role="alert" style={{ width: "100%", maxWidth: 480, border: "1px solid #3f3f46", borderRadius: 14, padding: 24, background: "#18181b", textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>LUCIAN needs to recover</h1>
            <p style={{ color: "#a1a1aa", lineHeight: 1.5 }}>The application shell encountered an unexpected problem. No action was completed by this error screen.</p>
            {error.digest && <p style={{ color: "#71717a", fontFamily: "monospace", fontSize: 11 }}>Reference: {error.digest}</p>}
            <button type="button" onClick={retry} style={{ marginTop: 8, border: 0, borderRadius: 8, padding: "10px 16px", background: "#f4f4f5", color: "#18181b", fontWeight: 700, cursor: "pointer" }}>
              Retry LUCIAN
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
