// LUCIAN Economic Agent — server-side AI provider abstraction.
//
// This module runs ONLY on the server (Node.js runtime). It reads API
// keys from process.env — never from the client. Keys are never logged,
// never returned in responses, and never sent to the browser.
//
// Supported providers:
//   - Google Gemini      (GEMINI_API_KEY,    gemini-2.0-flash)
//   - OpenAI             (OPENAI_API_KEY,    gpt-4o-mini)
//   - Anthropic           (ANTHROPIC_API_KEY, claude-3-5-sonnet-20241022)
//   - OpenRouter          (OPENROUTER_API_KEY, openai/gpt-4o-mini)
//   - DeepSeek            (DEEPSEEK_API_KEY,  deepseek-chat)
//   - Custom OpenAI-compat (CUSTOM_AI_API_KEY + CUSTOM_AI_BASE_URL)
//
// Each provider implements the `AIProvider` interface. The caller
// passes the providerId + modelId; this module looks up the right
// adapter and API key from the environment.

import { imageParts, type ImageInput } from "./image-input";
import { supportsReasoning, type ReasoningEffort } from "./model-capabilities";
import type { ProviderId } from "@/store/economic-agent-connection";
import { readOwnerCredential } from "@/lib/security/owner-credentials";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: ImageInput[];
}

export interface AIProvider {
  /** Send a chat completion request. Returns the assistant's text reply. */
  chat(params: {
    messages: ChatMessage[];
    model: string;
    systemPrompt?: string;
    reasoningEffort?: ReasoningEffort;
  }): Promise<{ content: string; fromModel: boolean }>;

  /** Read-only credential check; does not verify inference or spend tokens. */
  test(): Promise<{ success: boolean; message: string; reason?: string }>;
}

/** Look up the API key for a provider from the server environment. */
function environmentApiKey(provider: ProviderId): string | undefined {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    case "custom":
      return process.env.CUSTOM_AI_API_KEY;
    default:
      return undefined;
  }
}

async function getApiKey(provider: ProviderId, ownerUserId?: string): Promise<string | undefined> {
  if (ownerUserId) {
    try {
      const stored = await readOwnerCredential(ownerUserId, provider, "api_key");
      if (stored) return stored;
    } catch {
      // Invalid/missing encryption configuration must not expose data. An
      // environment key can still keep the provider operational.
    }
  }
  return environmentApiKey(provider);
}

/** Get the provider adapter, or null if the API key is not configured. */
export async function getProvider(provider: ProviderId, ownerUserId?: string): Promise<AIProvider | null> {
  const apiKey = await getApiKey(provider, ownerUserId);
  if (!apiKey) return null;

  switch (provider) {
    case "gemini":
      return createGeminiProvider(apiKey);
    case "openai":
      return createOpenAIProvider(apiKey, "https://api.openai.com/v1", "openai");
    case "anthropic":
      return createAnthropicProvider(apiKey);
    case "openrouter":
      return createOpenAIProvider(apiKey, "https://openrouter.ai/api/v1", "openrouter");
    case "deepseek":
      return createOpenAIProvider(apiKey, "https://api.deepseek.com/v1");
    case "custom":
      return createOpenAIProvider(
        apiKey,
        process.env.CUSTOM_AI_BASE_URL || "http://localhost:11434/v1",
      );
    default:
      return null;
  }
}

/** Check whether a provider's API key is present in the environment. */
export async function isProviderConfigured(provider: ProviderId, ownerUserId?: string): Promise<boolean> {
  return !!(await getApiKey(provider, ownerUserId));
}

/* ── Gemini ── */

function createGeminiProvider(apiKey: string): AIProvider {
  const baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  return {
    async chat({ messages, model, systemPrompt }) {
      // Convert to Gemini's format.
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }, ...(m.images ?? []).map(image => ({ inlineData: imageParts(image) }))],
        }));

      const systemInstruction = systemPrompt
        ? { parts: [{ text: systemPrompt }] }
        : undefined;

      const res = await fetch(
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({
            contents,
            ...(systemInstruction ? { systemInstruction } : {}),
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
            },
          }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const content = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("\n") ?? "";
      return { content: content.trim(), fromModel: true };
    },

    async test() {
      try {
        const res = await fetch(
          `${baseUrl}/models`, {headers: {"x-goog-api-key": apiKey}, signal: AbortSignal.timeout(10000)},
        );
        if (!res.ok) {
          return {
            success: false,
            message: "Gemini API key rejected",
            reason: `HTTP ${res.status}`,
          };
        }
        return { success: true, message: "Gemini API key is valid" };
      } catch (e) {
        return {
          success: false,
          message: "Network error contacting Gemini",
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

/* ── OpenAI-compatible (OpenAI, OpenRouter, DeepSeek, Custom) ── */

function createOpenAIProvider(apiKey: string, baseUrl: string, providerId: string = "custom"): AIProvider {
  return {
    async chat({ messages, model, systemPrompt, reasoningEffort }) {
      const allMessages: ChatMessage[] = [];
      if (systemPrompt) {
        allMessages.push({ role: "system", content: systemPrompt });
      }
      allMessages.push(...messages);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: allMessages.map(m => ({role:m.role, content:m.images?.length ? [{type:"text",text:m.content}, ...m.images.map(image => ({type:"image_url",image_url:{url:image.url}}))] : m.content})),
          ...(supportsReasoning(providerId,model) ? {reasoning_effort:reasoningEffort??"medium",max_completion_tokens:8192} : {temperature:0.7,max_tokens:2048}),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      return { content: content.trim(), fromModel: true };
    },

    async test() {
      try {
        // OpenRouter's model catalog is public and cannot authenticate a key.
        const res = await fetch(`${baseUrl}/${providerId === "openrouter" ? "key" : "models"}`, {
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
          return {
            success: false,
            message: "API key rejected",
            reason: `HTTP ${res.status}`,
          };
        }
        if (providerId === "openrouter") {
          const payload = await res.json() as { data?: unknown };
          if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
            return { success: false, message: "Provider returned an invalid authentication response" };
          }
        }
        return { success: true, message: "API key is valid" };
      } catch (e) {
        return {
          success: false,
          message: "Network error contacting provider",
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

/* ── Anthropic ── */

function createAnthropicProvider(apiKey: string): AIProvider {
  const baseUrl = "https://api.anthropic.com/v1";

  return {
    async chat({ messages, model, systemPrompt }) {
      const filtered = messages.filter((m) => m.role !== "system");

      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: filtered.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.images?.length ? [{type:"text",text:m.content}, ...m.images.map(image => {const parts=imageParts(image); return {type:"image",source:{type:"base64",media_type:parts.mimeType,data:parts.data}};})] : m.content,
          })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        content?: { text?: string }[];
      };
      const content = data.content?.map(p => p.text ?? "").join("\n") ?? "";
      return { content: content.trim(), fromModel: true };
    },

    async test() {
      try {
        // Read-only credential check; never spends completion tokens.
        const res = await fetch(`${baseUrl}/models`, {
          headers: {"x-api-key": apiKey, "anthropic-version": "2023-06-01"},
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          return {
            success: false,
            message: "Anthropic API key rejected",
            reason: `HTTP ${res.status}`,
          };
        }
        return { success: true, message: "Anthropic API key is valid" };
      } catch (e) {
        return {
          success: false,
          message: "Network error contacting Anthropic",
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

/** Discovery requests list models; they never generate paid completions. */
export async function discoverModels(provider: ProviderId, owner: string) {
  const apiKey = await getApiKey(provider, owner);
  if (!apiKey) return { configured: false, models: [] as string[], complete: true };
  const endpoints = {gemini:"https://generativelanguage.googleapis.com/v1beta",openai:"https://api.openai.com/v1",anthropic:"https://api.anthropic.com/v1",openrouter:"https://openrouter.ai/api/v1",deepseek:"https://api.deepseek.com/v1",custom:process.env.CUSTOM_AI_BASE_URL || ""};
  const base = endpoints[provider].replace(/\/$/, "");
  if (!base) throw Error("Provider URL is not configured.");
  const headers: Record<string,string> = provider === "gemini" ? {"x-goog-api-key":apiKey} : provider === "anthropic" ? {"x-api-key":apiKey,"anthropic-version":"2023-06-01"} : {Authorization:`Bearer ${apiKey}`};
  const models = new Set<string>();
  const next = new URL(`${base}/models`);
  let complete = false;
  // Bounded pagination for Gemini and Anthropic catalogs. Never follow a
  // provider-supplied URL (which could leak authentication to another host).
  for (let page=0;page<5;page++) {
    const response=await fetch(next,{headers,cache:"no-store",signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error("Unable to list models. Check the connection in Settings.");
    const result=await response.json();
    const entries=provider === "gemini" ? result.models : result.data;
    for (const item of Array.isArray(entries) ? entries : []) {
      if (provider === "gemini" && !item.supportedGenerationMethods?.includes("generateContent")) continue;
      const id=typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
      if (id) models.add(id.replace(/^models\//,""));
    }
    if (provider === "gemini" && typeof result.nextPageToken === "string" && result.nextPageToken) next.searchParams.set("pageToken",result.nextPageToken);
    else if (provider === "anthropic" && result.has_more === true && typeof result.last_id === "string") next.searchParams.set("after_id",result.last_id);
    else {complete=true;break;}
    if (models.size>=500)break;
  }
  return {configured:true,models:[...models].slice(0,500),complete:complete && models.size<=500};
}
