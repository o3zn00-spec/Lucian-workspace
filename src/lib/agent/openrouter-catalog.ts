import type { ReasoningEffort } from "./model-capabilities";
export type RouterCapability = { efforts: ReasoningEffort[]; images: boolean };
export function routerCapability(item: { reasoning?: { supported_efforts?: unknown; mandatory?: boolean }; architecture?: { input_modalities?: string[] } }): RouterCapability {
  const supported = item.reasoning?.supported_efforts;
  return { efforts: (["none", "minimal", "low", "medium", "high", "xhigh", "max"] as ReasoningEffort[]).filter(level => !(level === "none" && item.reasoning?.mandatory) && (supported === null || (Array.isArray(supported) && supported.includes(level)))), images: item.architecture?.input_modalities?.includes("image") === true };
}
let cache: { until: number; models: Record<string, RouterCapability> } | undefined;
export async function routerModelCapability(model: string): Promise<RouterCapability | undefined> {
  if (cache && cache.until > Date.now()) return cache.models[model];
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) return undefined;
    const body = await response.json();
    const models: Record<string, RouterCapability> = {};
    for (const item of Array.isArray(body.data) ? body.data.slice(0, 2000) : []) if (typeof item?.id === "string") models[item.id] = routerCapability(item);
    cache = { until: Date.now() + 300000, models }; return models[model];
  } catch { return undefined; }
}
