import "server-only";

import { createHmac } from "node:crypto";
import { readOwnerCredential } from "@/lib/security/owner-credentials";

export type BybitEnvironment = "testnet" | "mainnet";

const REST_BASES: Record<BybitEnvironment, string> = {
  testnet: "https://api-testnet.bybit.com",
  mainnet: "https://api.bybit.com",
};

const PUBLIC_WS_BASES: Record<BybitEnvironment, string> = {
  testnet: "wss://stream-testnet.bybit.com/v5/public",
  mainnet: "wss://stream.bybit.com/v5/public",
};

type QueryValue = string | number | boolean | undefined;
type BybitEnvelope<T> = { retCode: number; retMsg: string; result: T; retExtInfo?: unknown; time?: number };

export class BybitApiError extends Error {
  constructor(message: string, readonly code: number, readonly httpStatus = 400) {
    super(message);
    this.name = "BybitApiError";
  }
}

function normalizeEnvironment(value: string | null | undefined): BybitEnvironment {
  return value?.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

async function storedOrEnv(ownerUserId: string, key: "api_key" | "api_secret" | "environment") {
  const stored = await readOwnerCredential(ownerUserId, "bybit", key);
  if (stored) return stored;
  if (key === "api_key") return process.env.BYBIT_API_KEY?.trim() || null;
  if (key === "api_secret") return process.env.BYBIT_API_SECRET?.trim() || null;
  return process.env.BYBIT_ENVIRONMENT?.trim() || "testnet";
}

export async function getBybitConfig(ownerUserId: string) {
  const [apiKey, apiSecret, storedEnvironment] = await Promise.all([
    storedOrEnv(ownerUserId, "api_key"),
    storedOrEnv(ownerUserId, "api_secret"),
    storedOrEnv(ownerUserId, "environment"),
  ]);
  const environment = normalizeEnvironment(storedEnvironment);
  return {
    apiKey,
    apiSecret,
    environment,
    configured: Boolean(apiKey && apiSecret),
    baseUrl: REST_BASES[environment],
    publicWebSocketBase: PUBLIC_WS_BASES[environment],
  };
}

function queryString(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as BybitEnvelope<T> | null;
  if (!payload) throw new BybitApiError(`Bybit returned an unreadable response (${response.status}).`, -1, response.status);
  if (!response.ok || payload.retCode !== 0) {
    throw new BybitApiError(payload.retMsg || `Bybit request failed (${response.status}).`, payload.retCode, response.status);
  }
  return payload.result;
}

export async function bybitRequest<T>(
  ownerUserId: string,
  path: string,
  options: { method?: "GET" | "POST"; query?: Record<string, QueryValue>; body?: Record<string, unknown> } = {},
): Promise<T> {
  if (!path.startsWith("/v5/")) throw new Error("Bybit request paths must begin with /v5/.");
  const config = await getBybitConfig(ownerUserId);
  if (!config.apiKey || !config.apiSecret) {
    throw new BybitApiError("Bybit is not configured. Save the API key and secret in Settings → Connections.", 10003, 503);
  }

  const method = options.method ?? "GET";
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = queryString(options.query);
  const body = method === "POST" ? JSON.stringify(options.body ?? {}) : "";
  const payloadToSign = `${timestamp}${config.apiKey}${recvWindow}${method === "GET" ? query : body}`;
  const signature = createHmac("sha256", config.apiSecret).update(payloadToSign).digest("hex");
  const response = await fetch(`${config.baseUrl}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-BAPI-API-KEY": config.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
    body: method === "POST" ? body : undefined,
    cache: "no-store",
  });
  return parseEnvelope<T>(response);
}

export async function bybitPublicRequest<T>(
  environment: BybitEnvironment,
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<T> {
  const encoded = queryString(query);
  const response = await fetch(`${REST_BASES[environment]}${path}${encoded ? `?${encoded}` : ""}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return parseEnvelope<T>(response);
}

export async function getBybitConnectionStatus(ownerUserId: string) {
  const config = await getBybitConfig(ownerUserId);
  if (!config.configured) {
    return {
      id: "bybit",
      type: "crypto" as const,
      name: "bybit",
      displayName: "Bybit",
      environment: config.environment,
      configured: false,
      authenticated: false,
      connectedAt: undefined,
      state: "not_configured" as const,
      stateDetail: "Encrypted Bybit API key and secret are missing.",
    };
  }
  try {
    await bybitRequest(ownerUserId, "/v5/account/wallet-balance", { query: { accountType: "UNIFIED" } });
    return {
      id: "bybit",
      type: "crypto" as const,
      name: "bybit",
      displayName: "Bybit",
      environment: config.environment,
      configured: true,
      authenticated: true,
      connectedAt: Date.now(),
      state: "connected" as const,
      stateDetail: `Authenticated against Bybit ${config.environment}.`,
    };
  } catch (error) {
    return {
      id: "bybit",
      type: "crypto" as const,
      name: "bybit",
      displayName: "Bybit",
      environment: config.environment,
      configured: true,
      authenticated: false,
      connectedAt: undefined,
      state: "error" as const,
      stateDetail: error instanceof Error ? error.message : "Bybit authentication failed.",
    };
  }
}
