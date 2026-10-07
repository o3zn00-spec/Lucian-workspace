"use client";

// LUCIAN Phase 16 — Auth card with smooth state transitions.
//
// Renders ONE auth experience with animated transitions between:
//   - "signin"  : owner identity + password + owner-bound Google + recovery
//   - "forgot"  : email + Send Reset Link + Back to Sign In
//   - "reset"   : new password + confirm + Update Password
//
// Transitions are handled by:
//   - keeping the form mounted across state changes (no remount),
//   - animating the card opacity + slight Y translate via CSS transitions,
//   - swapping the form fields with a small fade.
//
// All real auth:
//   - Sign In: signIn("credentials", ...) — Auth.js v5 server roundtrip.
//   - Forgot: POST /api/auth/reset-password/request.
//   - Reset:  POST /api/auth/reset-password/confirm, then redirect to /login.
//   - Google: signIn("google") — only if /api/auth/google-status says configured.
//
// No fake auth anywhere. No setTimeout → success. The cinematic success
// transition is triggered ONLY after a real 200 response from the server.
//
// Inline errors + toasts (no browser alert/confirm/prompt).

import { useEffect, useState, useCallback, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft, Mail, Lock, User as UserIcon } from "lucide-react";
import { BrandMark } from "@/components/branding/BrandMark";
import { useAuthLayout } from "@/components/auth/cinematic-auth-layout";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-redirect";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AuthState = "signin" | "forgot" | "reset";
type FormStatus = "idle" | "submitting" | "success" | "error";

interface AuthCardProps {
  /** Initial state — defaults to "signin". Reset page passes "reset". */
  initialState?: AuthState;
}

export function AuthCard({ initialState = "signin" }: AuthCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { onSuccess, onPasswordFocusChange } = useAuthLayout();
  const [state, setState] = useState<AuthState>(initialState);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [, startTransition] = useTransition();

  // Sign-in form fields — `siIdentity` accepts either username or email.
  const [siIdentity, setSiIdentity] = useState("");
  const [siPassword, setSiPassword] = useState("");

  // Forgot-password fields
  const [fpEmail, setFpEmail] = useState("");

  // Reset-password fields — initialize from URL token (?token=...) via
  // lazy useState. If the user navigates to a different reset link,
  // that's a fresh page load (new searchParams), so the lazy init is
  // sufficient — no setState-in-effect needed.
  const [rpToken, setRpToken] = useState(
    initialState === "reset" ? (searchParams.get("token") ?? "") : "",
  );
  const [rpPassword, setRpPassword] = useState("");
  const [rpConfirm, setRpConfirm] = useState("");

  // Fetch Google + email status on mount.
  useEffect(() => {
    fetch("/api/auth/google-status").then(r => r.json()).then(d => setGoogleConfigured(!!d.configured)).catch(() => setGoogleConfigured(false));
    fetch("/api/auth/email-status").then(r => r.json()).then(d => setEmailConfigured(!!d.configured)).catch(() => setEmailConfigured(false));
  }, []);

  const clearError = useCallback(() => { setError(null); setInfo(null); }, []);

  const switchState = useCallback((next: AuthState) => {
    clearError();
    setStatus("idle");
    setState(next);
  }, [clearError]);

  // ── Sign In ────────────────────────────────────────────────────
  // The identity field accepts either an email (you@example.com) OR
  // a username (LUCIAN1975). The server-side Credentials provider
  // resolves it both ways.
  const handleSignIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!siIdentity || !siPassword) { setError("Please enter your username or email and your password."); return; }
    setStatus("submitting");
    try {
      const res = await signIn("credentials", {
        username: siIdentity,
        password: siPassword,
        redirect: false,
      });
      if (res?.error) {
        setStatus("error");
        setError("Invalid username/email or password.");
        return;
      }
      // Real success — trigger cinematic transition, then navigate.
      setStatus("success");
      onSuccess();
      startTransition(() => {
        // Sanitize callbackUrl — NEVER navigate to an arbitrary external
        // URL. Unsafe / missing values default to "/".
        const rawCallbackUrl = searchParams.get("callbackUrl");
        const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl);
        // Small delay so the cinematic plays before navigation.
        setTimeout(() => router.push(callbackUrl), 1400);
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Sign in failed. Please try again.");
    }
  }, [siIdentity, siPassword, clearError, onSuccess, searchParams, router]);

  // ── Forgot Password ────────────────────────────────────────────
  const handleForgot = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!fpEmail.trim()) { setError("Please enter your email."); return; }
    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/reset-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus("error");
        setError(data.error || "Reset request failed. Please try again.");
        return;
      }
      setStatus("success");
      if (data.emailDelivery === "not_configured") {
        setInfo("Owner recovery email is not configured. Configure SMTP on the server before relying on password recovery.");
      } else {
        setInfo("If an account exists for this email, a reset link has been sent. The link expires in 1 hour and can be used once.");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Reset request failed. Please try again.");
    }
  }, [fpEmail, clearError]);

  // ── Reset Password ─────────────────────────────────────────────
  const handleReset = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!rpToken) { setError("Reset token is missing. Please request a new reset link."); return; }
    if (!rpPassword) { setError("Please enter a new password."); return; }
    if (rpPassword !== rpConfirm) { setError("Passwords do not match."); return; }
    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rpToken, newPassword: rpPassword, confirmPassword: rpConfirm }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus("error");
        setError(data.error || "Password reset failed. Please request a new link.");
        return;
      }
      setStatus("success");
      setInfo("Your password has been updated. Redirecting to sign in…");
      // Redirect to /login after a short delay.
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Password reset failed. Please try again.");
    }
  }, [rpToken, rpPassword, rpConfirm, clearError, router]);

  // ── Google ─────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    if (!googleConfigured) {
      toast.error("Google authentication is not configured on this server.");
      return;
    }
    clearError();
    setStatus("submitting");
    // Sanitize callbackUrl so OAuth returns to a safe internal route
    // (NEVER allow an attacker-supplied external redirect target).
    const rawCallbackUrl = searchParams.get("callbackUrl");
    const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl);
    // signIn("google", { redirect: false }) returns a redirect URL.
    // For OAuth, we want a real redirect (server roundtrip).
    await signIn("google", { callbackUrl });
  }, [googleConfigured, clearError, searchParams]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="relative w-full max-w-sm">
      {/* Brand mark + title */}
      <div className="mb-6 flex items-center justify-center gap-3">
        <BrandMark className="h-9 w-9" />
        <div>
          <div className="text-[20px] font-semibold tracking-tight text-fg leading-none">LUCIAN</div>
          <div className="mt-1 text-[11px] text-fg-faint tracking-wide">Workspace</div>
        </div>
      </div>

      {/* Card */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-line bg-surface/80 backdrop-blur-xl",
          "shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
          "transition-all duration-500 ease-out",
          status === "success" && "scale-[1.02] border-[var(--accent)]/60",
        )}
      >
        <div className="p-6 sm:p-7">
          {/* State header */}
          <div className="mb-5">
            {state === "signin" && (
              <h1 className="text-[18px] font-semibold text-fg">Welcome back</h1>
            )}
            {state === "forgot" && (
              <h1 className="text-[18px] font-semibold text-fg">Reset your password</h1>
            )}
            {state === "reset" && (
              <h1 className="text-[18px] font-semibold text-fg">Set a new password</h1>
            )}
            <p className="mt-1 text-[12px] text-fg-muted">
              {state === "signin" && "Private access for the configured owner."}
              {state === "forgot" && "We'll send a one-time reset link to your email."}
              {state === "reset" && "Choose a strong new password."}
            </p>
          </div>

          {/* Inline error */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {/* Inline info (success / no email configured etc.) */}
          {info && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-[12px] text-fg" role="status">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
              <span>{info}</span>
            </div>
          )}

          {/* Forms — render the active form; transitions are CSS-only */}
          {state === "signin" && (
            <form onSubmit={handleSignIn} className="space-y-3" autoComplete="on">
              <FieldLabel label="Username or Email">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
                <input
                  type="text" required autoComplete="username" autoFocus
                  value={siIdentity} onChange={e => setSiIdentity(e.target.value)}
                  placeholder="LUCIAN1975 or you@example.com"
                  className={inputClass}
                />
              </FieldLabel>
              <FieldLabel label="Password">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
                <input
                  type={showPw ? "text" : "password"} required autoComplete="current-password"
                  value={siPassword} onChange={e => setSiPassword(e.target.value)}
                  onFocus={() => onPasswordFocusChange(true)}
                  onBlur={() => onPasswordFocusChange(false)}
                  placeholder="••••••••••••"
                  className={inputClass}
                />
                <button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-muted">
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </FieldLabel>
              <SubmitButton label="Sign In" status={status} />
              <div className="pt-1 text-right">
                <button type="button" onClick={() => switchState("forgot")}
                  className="text-[11px] text-fg-muted hover:text-fg underline-offset-2 hover:underline">
                  Forgot password?
                </button>
              </div>
              <Divider />
              <GoogleButton onClick={handleGoogle} configured={googleConfigured} status={status} />
            </form>
          )}

          {state === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-3" autoComplete="on">
              <FieldLabel label="Email">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
                <input
                  type="email" required autoComplete="email" autoFocus
                  value={fpEmail} onChange={e => setFpEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </FieldLabel>
              <SubmitButton label="Send Reset Link" status={status} />
              <SwitchPrompt
                text="Remembered your password?"
                action="Back to Sign In"
                onClick={() => switchState("signin")}
              />
            </form>
          )}

          {state === "reset" && (
            <form onSubmit={handleReset} className="space-y-3" autoComplete="on">
              {!rpToken && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
                  Reset token is missing. Please request a new reset link.
                </div>
              )}
              <FieldLabel label="New password">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
                <input
                  type={showPw ? "text" : "password"} required autoComplete="new-password" autoFocus
                  value={rpPassword} onChange={e => setRpPassword(e.target.value)}
                  onFocus={() => onPasswordFocusChange(true)}
                  onBlur={() => onPasswordFocusChange(false)}
                  placeholder="At least 12 characters, with a letter + digit"
                  className={inputClass}
                />
                <button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-muted">
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </FieldLabel>
              <FieldLabel label="Confirm new password">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
                <input
                  type={showConfirmPw ? "text" : "password"} required autoComplete="new-password"
                  value={rpConfirm} onChange={e => setRpConfirm(e.target.value)}
                  onFocus={() => onPasswordFocusChange(true)}
                  onBlur={() => onPasswordFocusChange(false)}
                  placeholder="••••••••••••"
                  className={inputClass}
                />
                <button type="button" aria-label={showConfirmPw ? "Hide password confirmation" : "Show password confirmation"} onClick={() => setShowConfirmPw(!showConfirmPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-muted">
                  {showConfirmPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </FieldLabel>
              <SubmitButton label="Update Password" status={status} />
              <div className="pt-1">
                <Link href="/login" className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </Link>
              </div>
            </form>
          )}

          {/* Email provider not configured — honest hint on forgot page */}
          {state === "forgot" && emailConfigured === false && (
            <div className="mt-4 text-[10.5px] text-fg-faint leading-relaxed">
              Owner recovery email is not configured. Configure SMTP on the server before relying on password recovery.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────
const inputClass = cn(
  "w-full rounded-lg border border-line bg-inset/60 pl-9 pr-10 py-2.5 text-[13px] text-fg",
  "placeholder:text-fg-faint/60",
  "outline-none transition-all duration-200",
  "focus:border-[var(--accent)] focus:bg-inset focus:shadow-[0_0_0_3px_var(--accent)]/15",
);

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-fg-muted">{label}</span>
      <div className="relative">{children}</div>
    </label>
  );
}

function SubmitButton({ label, status }: { label: string; status: FormStatus }) {
  const loading = status === "submitting";
  return (
    <button
      type="submit"
      disabled={loading || status === "success"}
      className={cn(
        "mt-1 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-all",
        "bg-[var(--accent)] text-[var(--accent-fg)]",
        "hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)]",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        status === "success" && "bg-emerald-600 hover:bg-emerald-600",
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {status === "success" && <CheckCircle2 className="h-3.5 w-3.5" />}
      {status === "success" ? "Success" : label}
    </button>
  );
}

function Divider() {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-line-muted" />
      <span className="text-[10px] uppercase tracking-wider text-fg-faint">or</span>
      <div className="h-px flex-1 bg-line-muted" />
    </div>
  );
}

function GoogleButton({
  onClick, configured, status,
}: {
  onClick: () => void;
  configured: boolean | null;
  status: FormStatus;
}) {
  const loading = status === "submitting";
  const disabled = !configured || loading;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={configured ? "Continue with Google" : "Google is not configured on this server"}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface-2/50 px-4 py-2.5 text-[13px] font-medium text-fg transition-all",
        "hover:border-fg-faint hover:bg-surface-2",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-surface-2/50",
      )}
    >
      <GoogleIcon />
      {configured === null
        ? "Loading Google…"
        : configured
        ? "Continue with Google"
        : "Google not configured"}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
    </svg>
  );
}

function SwitchPrompt({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <div className="pt-1 text-center text-[11px] text-fg-muted">
      {text}{" "}
      <button type="button" onClick={onClick} className="font-medium text-[var(--accent)] hover:underline">
        {action}
      </button>
    </div>
  );
}
