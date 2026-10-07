import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { AppShell } from "@/components/layout/AppShell";
import { AppearanceApplier } from "@/components/settings/appearance-applier";
import { PostLoginMigrationPrompt } from "@/components/auth/post-login-migration-prompt";
import { LiveSyncMount } from "@/lib/auth/live-sync-mount";
import { CloudHydrationMount } from "@/lib/auth/cloud-hydration-mount";
import { IsolationBoundary } from "@/components/layout/IsolationBoundary";

/**
 * Application shell layout.
 *
 * This layout renders the persistent global chrome (top nav, sidebar,
 * settings modal) once, then mounts each route's content into the main
 * area via {children}. Because Next.js preserves layouts across route
 * changes, the shell never unmounts during in-app navigation — sidebar
 * state, theme state and settings state all carry over.
 *
 * Phase 16: wraps AppShell in SessionProvider so all (app) components
 * (ProfileMenu, Settings → Account, etc.) can call useSession().
 *
 * AppearanceApplier reads the appearance + accessibility slices of
 * useSettingsStore and writes them to <html> dataset attributes so
 * CSS can react (density, font scale, reduced motion, rounded,
 * high-contrast, larger text, keyboard focus). It renders nothing.
 *
 * PostLoginMigrationPrompt: shows the local → server migration prompt
 * ONCE after a fresh login if the user has eligible local data. The
 * user can choose "Keep Local Only" or "Add Eligible Data to My
 * Account". The prompt is non-blocking and can be re-triggered from
 * Settings → Data & Storage.
 *
 * LiveSyncMount: starts the best-effort retry loop that drains pending
 * server-sync records (chats / notifications / saved-items) when the
 * user is authenticated. Local mutations are queued into localStorage
 * when the server is unreachable; this loop drains the queue every
 * 30 seconds. Local data is NEVER destroyed by a sync failure.
 *
 * CloudHydrationMount: fetches the authenticated user's server-backed
 * data (chats / notifications / saved-items) and merges it into the
 * local stores when the session becomes authenticated. Hydration is
 * idempotent, dedupe-aware, and silent (no notification sounds). If
 * the server is unreachable, local data is preserved (no white screen).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <IsolationBoundary><AppShell>
        <AppearanceApplier />
        {children}
        <PostLoginMigrationPrompt />
        <LiveSyncMount />
        <CloudHydrationMount />
      </AppShell></IsolationBoundary>
    </SessionProvider>
  );
}
