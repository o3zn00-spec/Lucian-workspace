"use client";

// Original stores call this after messages settle. The mounted bridge below
// synchronizes the complete conversation, including pin/archive/rename state.
export async function syncChatMessage(_input: {
  conversationId: string; messageId?: string; source: string; title: string;
  role: string; content: string; model?: string; provider?: string;
}): Promise<void> { /* sync is owned by the serialized bridge subscription */ }
