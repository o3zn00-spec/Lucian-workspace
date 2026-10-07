"use client";

export interface StreamChatOptions {
  endpoint?: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta: (content: string, accumulated: string) => void;
}

export interface StreamChatResult {
  content: string;
  provider?: string;
  model?: string;
}

/**
 * Read LUCIAN's newline-delimited chat stream. The helper also accepts the
 * legacy JSON response so older/specialized endpoints can migrate without a
 * flag day.
 */
export async function streamChatResponse({
  endpoint = "/api/ai/chat",
  body,
  signal,
  onDelta,
}: StreamChatOptions): Promise<StreamChatResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson") || !response.body) {
    const data = await response.json() as {
      success?: boolean;
      content?: string;
      message?: string;
      error?: string;
      errorType?: string;
      provider?: string;
      model?: string;
    };
    if (!response.ok || data.success === false) {
      throw new ChatResponseError(data.message ?? data.error ?? "The model request failed.", data.errorType, response.status);
    }
    const content = data.content ?? "";
    onDelta(content, content);
    return { content, provider: data.provider, model: data.model };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let provider: string | undefined;
  let model: string | undefined;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type: "meta" | "delta" | "done" | "error";
      delta?: string;
      provider?: string;
      model?: string;
      message?: string;
      errorType?: string;
      statusCode?: number;
    };
    if (event.type === "meta") {
      provider = event.provider;
      model = event.model;
    } else if (event.type === "delta" && event.delta) {
      accumulated += event.delta;
      onDelta(event.delta, accumulated);
    } else if (event.type === "error") {
      throw new ChatResponseError(event.message ?? "The model request failed.", event.errorType, event.statusCode);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  return { content: accumulated, provider, model };
}

export class ChatResponseError extends Error {
  readonly errorType?: string;
  readonly statusCode?: number;

  constructor(message: string, errorType?: string, statusCode?: number) {
    super(message);
    this.name = "ChatResponseError";
    this.errorType = errorType;
    this.statusCode = statusCode;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

