// LUCIAN Phase 16 — Sign Up page.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  redirect("/login?reason=owner-only");
}
