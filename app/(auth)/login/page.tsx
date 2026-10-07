// LUCIAN Phase 16 — Sign In page.
//
// Renders the AuthCard with initialState="signin". The (auth) layout
// provides the cinematic scene + the onSuccess / onPasswordFocusChange
// callbacks.

import { AuthCard } from "@/components/auth/auth-card";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthCard initialState="signin" />
    </Suspense>
  );
}
