// Internal state never becomes ordinary model memory or editable owner memory.
export const PRIVATE_MEMORY_FILTER = { NOT: { OR: [
  { key: { startsWith: "_tool_permission:" } },
  { key: { startsWith: "_paper_session:" } },
  { key: { startsWith: "_spot_risk:" } },
  { key: { startsWith: "_workspace_edit:" } },
  { key: { startsWith: "_order_watch:" } },
  { key: { startsWith: "_live_review:" } },
  { key: { startsWith: "_live_session:" } },
] } };
export const isPrivateAssistantKey = (key: string) => key.startsWith("_tool_permission:") || key.startsWith("_paper_session:") || key.startsWith("_spot_risk:") || key.startsWith("_workspace_edit:") || key.startsWith("_order_watch:") || key.startsWith("_live_review:") || key.startsWith("_live_session:");
