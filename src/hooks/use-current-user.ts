"use client";

// LUCIAN Phase 16 — Client hook for the current authenticated user.
//
// Wraps next-auth/react's useSession to expose a simpler shape and
// re-fetch /api/auth/me so we have the full profile (display name,
// avatar, accounts, etc.) that Auth.js's session doesn't include.
//
// Used by:
//   - Settings → Account section (profile editing, security, sessions)
//   - ProfileMenu (display name + avatar in the dropdown)
//   - Any component that needs to know "who is the current user?"

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string;
  username: string;
  name: string | null;
  image: string | null;
  emailVerified: Date | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  accounts: Array<{ provider: string; providerAccountId: string }>;
}

export interface CurrentProfile {
  displayName: string;
  avatar: string | null;
  updatedAt: string;
}

interface UseCurrentUserState {
  user: CurrentUser | null;
  profile: CurrentProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Client hook for the current user + profile.
 *
 *  Implementation note: to avoid the `react-hooks/set-state-in-effect`
 *  lint rule (which fires for synchronous setState in effect bodies),
 *  we DON'T track an explicit `loading` state with setState — we
 *  derive it from session status + whether we have data yet. The
 *  fetch's setState calls all happen after `await`, so they're
 *  considered "external system updates", which the rule allows. */
export function useCurrentUser(): UseCurrentUserState {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    // Skip the fetch entirely if we're not authenticated.
    if (status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.error || "Failed to load account info.");
          return;
        }
        setUser(data.user);
        setProfile(data.profile);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load account info.");
      }
    })();
    return () => { cancelled = true; };
  }, [status, refreshKey]);

  // Derive `loading` rather than tracking it explicitly — this avoids
  // a synchronous setState in the effect body.
  const loading =
    status === "loading" || (status === "authenticated" && !user && !error);

  void session; // not used directly — status is enough

  return { user, profile, loading, error, refresh };
}

