// LUCIAN Phase 16 — Auth.js v5 route handler.
//
// Mounts the Auth.js v5 handlers at /api/auth/*.
//
// This file is the ONLY entry point Auth.js needs — it covers signin,
// signout, callback (OAuth), session read, and CSRF. Custom endpoints
// for signup, password reset, profile, and me are separate files
// under /api/auth/* (NOT inside this catch-all).

import { handlers } from "@/lib/auth/auth";

export const { GET, POST } = handlers;
