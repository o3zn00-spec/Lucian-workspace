// LUCIAN Phase 16 — Forgot Password page.

import { AuthCard } from "@/components/auth/auth-card";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthCard initialState="forgot" />
    </Suspense>
  );
}
