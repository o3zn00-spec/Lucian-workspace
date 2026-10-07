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
        description: `${attachment.type || "file"}, ${formatBytes(attachment.size)}. ${/^image\/(png|jpeg|webp|gif)$/.test(attachment.type) ? "Resized image preview supplied separately. Small text may require a cropped image; only the most recent image batch is forwarded." : "Metadata only; this binary file is not readable by the model."}`,
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


/** Retain bounded image previews in chat history; full source files stay local. */
export async function attachmentPreviews(attachments: LilithChatAttachment[]) {
  return Promise.all(attachments.slice(0,8).map(async item => {
    if(!/^image\/(png|jpeg|webp|gif)$/.test(item.type)) return {id:item.id,name:item.name};
    const image = await createImageBitmap(item.file).catch(() => {throw Error(`Cannot read ${item.name}. Use a PNG, JPEG, WebP or GIF image.`);});
    try {
      const scale=Math.min(1,1280/Math.max(image.width,image.height));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
      const ctx=canvas.getContext("2d");if(!ctx)throw Error("Image preparation is unavailable in this browser.");
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for (const quality of [0.75,0.55,0.35,0.2]) {const url=canvas.toDataURL("image/jpeg",quality);if(url.length<=100000)return {id:item.id,name:item.name,url};}
      throw Error(`${item.name} is too detailed for the current image limit. Crop the relevant area and reattach it.`);
    } finally {image.close();}
  }));
}
