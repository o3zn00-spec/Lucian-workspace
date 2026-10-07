// LUCIAN Phase 16 — Reset Password page (deep-linked from email).
//
// Reads ?token= from the URL and pre-populates the reset form. The
// middleware allows this page through even when authenticated (so a
// user who clicked the link while signed in can still complete the
// reset). The AuthCard calls /api/auth/reset-password/confirm.

import { AuthCard } from "@/components/auth/auth-card";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthCard initialState="reset" />
    </Suspense>
  );
}
