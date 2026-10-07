/** Known families only; unknown/custom models require provider verification. */
export function imageSupport(provider: string, model: string): "supported" | "unsupported" | "unverified" {
  const id = model.replace(/^openai\//, "");
  if (/embedding|o3-mini/.test(id)) return "unsupported";
  if (/audio|realtime|transcribe|tts/.test(id)) return "unverified";
  if (provider === "deepseek") return "unsupported";
  if (provider === "gemini" && /^gemini-/.test(model)) return "supported";
  if (provider === "anthropic" && /^claude-(?:3|sonnet-4|opus-4|haiku-4)/.test(model)) return "supported";
  if ((provider === "openai" || provider === "openrouter") && /^(?:gpt-4o|gpt-4\.1|gpt-[56]|o3(?:-|$)|o4(?:-|$))/.test(id)) return "supported";
  if (provider === "openai" && /^(?:gpt-3|gpt-4(?:-|$)|o1-mini)/.test(id) && !/vision/.test(id)) return "unsupported";
  return "unverified";
}
export type ReasoningEffort = "low" | "medium" | "high";
// Conservative support: these OpenAI reasoning families accept all three levels.
// A provider/model catalog entry is not proof that an account has access.
export function supportsReasoning(provider: string, model: string) {
  return (provider === "openai" || provider === "openrouter") && /^(?:openai\/)?(?:o[34](?:-|$)|gpt-[56](?:[.-]|$))/.test(model) && !/pro(?:-|$)/.test(model);
}
