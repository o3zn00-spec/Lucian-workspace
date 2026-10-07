// LUCIAN Phase 16 — (auth) route group layout.
//
// Wraps /login, /signup, /forgot-password, /reset-password with:
//   - SessionProvider (next-auth/react) — needed by signIn()
//   - ThemeProvider — so the auth page respects the user's chosen theme/accent
//   - CinematicAuthLayout — the 3D guardian scene + card container
//   - SonnerToaster — for non-blocking notifications
//
// Routes inside the (auth) group are PUBLIC (middleware allows them
// through). Authenticated users get bounced to / by middleware (except
// /reset-password?token=...).

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster as SonnerToaster } from "sonner";
import { CinematicAuthLayout } from "@/components/auth/cinematic-auth-layout";

export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <CinematicAuthLayout>
          {children}
        </CinematicAuthLayout>
        <SonnerToaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--surface)",
              color: "var(--fg)",
              border: "1px solid var(--line)",
            },
          }}
        />
      </ThemeProvider>
    </SessionProvider>
  );
}
