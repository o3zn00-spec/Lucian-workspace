// LUCIAN Vault API — Payment methods (cards).
// GET  /api/vault/payment-methods    — list saved cards
// POST /api/vault/payment-methods    — create setup intent (begin card saving)
//
// Cards are PAYMENT METHODS, not accounts. We never store PAN or CVV —
// only safe provider references and display metadata.
//
// When the database is available, saved payment methods are persisted
// in the PaymentMethod table. When Stripe is a stub, GET returns an
// empty list with providerConnected=false (no fake cards), and POST
// returns 503 with a clear message.

import { NextResponse } from "next/server";
import { getPaymentProvider, ProviderNotConfiguredError, ProviderStubError } from "@/lib/vault/providers";
import { apiError, apiResponse } from "@/lib/vault/validation";
import { db } from "@/lib/db";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Phase 16: ownership scoping.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  try {
    const provider = getPaymentProvider();
    if (!provider.isConfigured()) {
      return NextResponse.json({
        paymentMethods: [],
        providerConnected: false,
        message: "Provider not connected. Add a card to begin Stripe setup.",
      });
    }

    // Phase 16: scope by ownerUserId — only this user's saved methods.
    let dbMethods: import("@prisma/client").PaymentMethod[] = [];
    if (isDatabaseAvailable()) {
      dbMethods = await db.paymentMethod.findMany({
        where: { ownerUserId: userId },
        orderBy: { createdAt: "desc" },
      });
    }

    // If we have cached methods, return them. Otherwise, if the adapter
    // supports listPaymentMethods, fetch live (this throws for stubs).
    if (dbMethods.length > 0) {
      return NextResponse.json({
        paymentMethods: dbMethods.map((m) => ({
          providerPaymentMethodId: m.providerPaymentMethodId,
          brand: m.brand,
          last4: m.last4,
          expiryMonth: m.expiryMonth,
          expiryYear: m.expiryYear,
          isDefault: m.isDefault,
          depositEligible: m.depositEligible,
          withdrawalEligible: m.withdrawalEligible,
          displayName: m.displayName,
        })),
        providerConnected: true,
      });
    }

    // No cached methods — try the live adapter.
    try {
      const methods = (await provider.listPaymentMethods?.()) ?? [];
      return NextResponse.json({
        paymentMethods: methods.map((m) => ({
          providerPaymentMethodId: m.paymentMethodId,
          brand: m.brand,
          last4: m.last4,
          expiryMonth: m.expiryMonth,
          expiryYear: m.expiryYear,
          isDefault: m.isDefault,
          depositEligible: m.depositEligible,
          withdrawalEligible: m.withdrawalEligible,
          displayName: `${m.brand.charAt(0).toUpperCase() + m.brand.slice(1)} •••• ${m.last4}`,
        })),
        providerConnected: true,
      });
    } catch (err) {
      if (err instanceof ProviderStubError) {
        return NextResponse.json({
          paymentMethods: [],
          providerConnected: false,
          message: "Stripe SDK not loaded — install the `stripe` package to save cards.",
        });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ paymentMethods: [], providerConnected: false });
    }
    const message = err instanceof Error ? err.message : "Failed to list payment methods.";
    return apiError(message, 500);
  }
}

export async function POST(req: Request) {
  // PHASE 16 FINAL: require the authenticated user. Payment-method
  // setup intents are user-owned writes — ownerUserId is derived from
  // the session, NEVER from the body.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError("Invalid JSON body.", 400);
    }

    if (body.type !== "card") {
      return apiError("Only 'card' type is supported.", 400);
    }

    const currency = typeof body.currency === "string" ? body.currency : "USD";
    const provider = getPaymentProvider();

    if (!provider.isConfigured()) {
      return apiError(
        "Payment provider not connected. Set STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.",
        503, "provider_not_configured",
      );
    }

    if (!provider.createSetupIntent) {
      return apiError("Setup intent not supported by this provider.", 501);
    }

    let result;
    try {
      result = await provider.createSetupIntent({ currency });
    } catch (err) {
      if (err instanceof ProviderStubError) {
        return apiError(err.message, 503, "provider_stub");
      }
      throw err;
    }

    // We deliberately do NOT persist the PaymentMethod row here — the
    // row is created only AFTER the Stripe webhook confirms the setup
    // intent succeeded, and the webhook pipeline tags the row with
    // the original ownerUserId (resolved from the originating
    // transaction). This prevents orphan rows when a user abandons
    // the card-setup flow mid-way. We DO record the owner on the
    // response so the client can pass it back when finalizing.
    return apiResponse({
      clientSecret: result.clientSecret,
      setupIntentId: result.setupIntentId,
      ownerUserId: userId, // for client state only — server re-derives on finalize
      message: "Use this client secret with Stripe.js to securely collect card details.",
    });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return apiError(err.message, 503);
    }
    const message = err instanceof Error ? err.message : "Failed to create setup intent.";
    return apiError(message, 500);
  }
}
