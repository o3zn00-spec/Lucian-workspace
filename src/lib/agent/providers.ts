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

import type { ProviderId } from "@/store/economic-agent-connection";
import { readOwnerCredential } from "@/lib/security/owner-credentials";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIProvider {
  /** Send a chat completion request. Returns the assistant's text reply. */
  chat(params: {
    messages: ChatMessage[];
    model: string;
    systemPrompt?: string;
  }): Promise<{ content: string; fromModel: boolean }>;

  /** Send a minimal test request to verify the connection works. */
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
      return createOpenAIProvider(apiKey, "https://api.openai.com/v1");
    case "anthropic":
      return createAnthropicProvider(apiKey);
    case "openrouter":
      return createOpenAIProvider(apiKey, "https://openrouter.ai/api/v1");
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
          parts: [{ text: m.content }],
        }));

      const systemInstruction = systemPrompt
        ? { parts: [{ text: systemPrompt }] }
        : undefined;

      const res = await fetch(
        `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return { content: content.trim(), fromModel: true };
    },

    async test() {
      try {
        const res = await fetch(
          `${baseUrl}/models?key=${apiKey}`,
        );
        if (!res.ok) {
          return {
            success: false,
            message: "Gemini API key rejected",
            reason: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
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

function createOpenAIProvider(apiKey: string, baseUrl: string): AIProvider {
  return {
    async chat({ messages, model, systemPrompt }) {
      const allMessages: ChatMessage[] = [];
      if (systemPrompt) {
        allMessages.push({ role: "system", content: systemPrompt });
      }
      allMessages.push(...messages);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: allMessages,
          temperature: 0.7,
          max_tokens: 2048,
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
        // Use a minimal models list request to test the key.
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
          return {
            success: false,
            message: "API key rejected",
            reason: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
          };
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
            content: m.content,
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
      const content = data.content?.[0]?.text ?? "";
      return { content: content.trim(), fromModel: true };
    },

    async test() {
      try {
        // Anthropic doesn't have a /models endpoint, so we send a minimal
        // messages request to verify the key.
        const res = await fetch(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        if (!res.ok) {
          return {
            success: false,
            message: "Anthropic API key rejected",
            reason: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
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
