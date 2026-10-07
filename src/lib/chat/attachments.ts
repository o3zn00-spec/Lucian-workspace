"use client";

import type { LilithChatAttachment } from "@/components/chat/lilith-chat-ui";

export interface AttachmentContextItem {
  type: string;
  label: string;
  description: string;
  data?: string;
}

const TEXT_EXTENSIONS = /\.(?:txt|md|json|csv|ts|tsx|js|jsx|html|css|scss|py|java|go|rs|xml|yml|yaml|toml|env)$/i;
const MAX_TEXT_CHARS = 20_000;

/** Convert selected files into the text-context format understood by /api/ai/chat. */
export async function attachmentsToContext(attachments: LilithChatAttachment[]): Promise<AttachmentContextItem[]> {
  return Promise.all(attachments.slice(0, 8).map(async (attachment) => {
    const isText = attachment.type.startsWith("text/") || attachment.type.includes("json") || TEXT_EXTENSIONS.test(attachment.name);
    if (!isText) {
      return {
        type: attachment.type.startsWith("image/") ? "image-attachment" : "file-attachment",
        label: attachment.name,
        description: `${attachment.type || "file"}, ${formatBytes(attachment.size)}. Binary content is attached for reference but is not converted into text.`,
      };
    }
    const text = await attachment.file.text();
    return {
      type: "file-attachment",
      label: attachment.name,
      description: `${attachment.type || "text file"}, ${formatBytes(attachment.size)}`,
      data: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…[truncated]` : text,
    };
  }));
}

export function attachmentLabel(attachments: LilithChatAttachment[]): string {
  if (attachments.length === 0) return "";
  return `\n\nAttached: ${attachments.map((attachment) => attachment.name).join(", ")}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

