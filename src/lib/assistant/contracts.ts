export const ASSISTANT_IDENTITY = { id: "lucian-lilthe", name: "Lilthe", version: 1 } as const;

export const ASSISTANT_MODULES = [
  { id: "home", path: "/", label: "Home" },
  { id: "economic-agent", path: "/economic-agent", label: "Lilthe" },
  { id: "dev-workspace", path: "/dev-workspace", label: "DevWorkspace" },
  { id: "browser", path: "/browser", label: "Browser" },
  { id: "markets", path: "/markets", label: "Markets" },
  { id: "investing", path: "/investing", label: "Investing" },
  { id: "vault", path: "/vault", label: "Vault" },
  { id: "economy-hub", path: "/economy-hub", label: "Economy Hub" },
  { id: "news-feed", path: "/news-feed", label: "News" },
  { id: "research", path: "/research", label: "Research" },
  { id: "mindset-library", path: "/mindset-library", label: "Mindset Library" },
  { id: "chess-academy", path: "/chess-academy", label: "Chess" },
  { id: "notes", path: "/notes", label: "Notes" },
  { id: "settings", path: "/settings", label: "Settings" },
] as const;

export function isAssistantDestination(path: string) {
  return path === "/markets?paperSetup=1" || ASSISTANT_MODULES.some(module => module.path === path);
}

export type AssistantModule = typeof ASSISTANT_MODULES[number]["id"];
export function moduleForPath(path: string): AssistantModule {
  if (path === "/knowledge-library") return "mindset-library";
  return ASSISTANT_MODULES.find(m => m.path !== "/" && (path === m.path || path.startsWith(m.path + "/")))?.id ?? "home";
}

export const ASSISTANT_CAPABILITIES = [
  { id: "app.capabilities", available: true, description: "Read the maintained module and capability map." },
  { id: "app.navigate", available: true, description: "Return a validated app destination for explicit navigation." },
  { id: "saved.read", available: true, description: "Read at most 12 cloud-saved bookmark titles after explicit owner permission." },
  { id: "trading.read", available: true, description: "Read Bybit Unified balances after explicit owner permission; no financial execution." },
  { id: "trading.activity.read", available: true, description: "Read bounded Bybit spot open orders and USDT linear open orders/positions after separate owner permission." },
  { id: "trading.setup", available: true, description: "Open owner-reviewed simulated spot plan setup; saving does not authorize or start trading." },
  { id: "records.read", available: true, description: "Read bounded cloud-saved investing, research and news details after separate owner permission; excludes local holdings and notes." },
  { id: "workspace.read", available: true, description: "List cloud projects and read one indexed text file after separate owner permission; excludes environment settings and private credential paths." },
  { id: "workspace.propose", available: true, description: "Propose one existing cloud text-file change under project-read permission. Owner reviews before/after and applies the exact revision; no code runs or publishes." },
  { id: "research.run", available: false, description: "Sourced research awaits provider and research adapters." },
  { id: "workspace.edit", available: false, description: "Direct model writes are unavailable. Use workspace.propose and the owner-reviewed apply form for cloud text files." },
  { id: "trading.execute", available: false, description: "Requires implemented and authorized trading-session policy." },
  { id: "voice.talk", available: false, description: "Two-way voice awaits provider integration." },
] as const;

export function validateContext(value: unknown): { module: AssistantModule; recordId: string | null } {
  if (!value || typeof value !== "object") throw new Error("Choose a valid module context.");
  const { module, recordId } = value as Record<string, unknown>;
  if (!ASSISTANT_MODULES.some(m => m.id === module)) throw new Error("Unknown module context.");
  if (recordId != null && (typeof recordId !== "string" || recordId.length > 160)) throw new Error("Invalid record context.");
  // A record identifier is a reference, never evidence of permission to read it.
  return { module: module as AssistantModule, recordId: recordId as string | null ?? null };
}
