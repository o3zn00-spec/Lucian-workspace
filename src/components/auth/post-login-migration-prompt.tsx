"use client";

// LUCIAN Phase 16 — Post-login migration prompt wrapper.
//
// Listens for session state changes. When the user transitions from
// "unauthenticated" → "authenticated" (i.e. just signed in), show the
// migration prompt once. The prompt itself decides whether eligible
// local data exists.

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { MigrationPrompt } from "@/components/auth/migration-prompt";

export function PostLoginMigrationPrompt() {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const wasAuthedRef = useRef(false);

  useEffect(() => {
    // When transitioning to authenticated for the first time this
    // session, open the prompt after a short delay so the user sees
    // the workspace first. We do NOT close the prompt on
    // unauthenticated (the state defaults to false and is only
    // ever set true here, so a redundant `setOpen(false)` would
    // trigger the lint rule).
    if (status === "authenticated" && !wasAuthedRef.current) {
      wasAuthedRef.current = true;
      const t = setTimeout(() => setOpen(true), 1500);
      return () => clearTimeout(t);
    }
    // We don't reset wasAuthedRef or open state on unauthenticated
    // because:
    //   - wasAuthedRef.current tracks "have we shown the prompt this
    //     session" — if the user signs out and back in within the same
    //     React lifecycle, we don't want to re-prompt immediately.
    //   - open state defaults to false; it's only ever set true on
    //     first authenticated transition.
  }, [status]);

  return <MigrationPrompt open={open} onClose={() => setOpen(false)} />;
}
