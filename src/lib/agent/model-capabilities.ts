export type ReasoningEffort = "low" | "medium" | "high";
// Conservative support: these OpenAI reasoning families accept all three levels.
// A provider/model catalog entry is not proof that an account has access.
export function supportsReasoning(provider: string, model: string) {
  return (provider === "openai" || provider === "openrouter") && /^(?:openai\/)?(?:o[34](?:-|$)|gpt-[56](?:[.-]|$))/.test(model) && !/pro(?:-|$)/.test(model);
}
