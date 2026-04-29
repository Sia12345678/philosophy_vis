import type { ProviderConfig } from "./providers";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

export interface StreamChatOpts {
  provider: ProviderConfig;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}

export class ChatError extends Error {
  constructor(
    message: string,
    public kind: "auth" | "rate" | "network" | "server" | "unknown",
    public status?: number,
  ) {
    super(message);
  }
}

export async function* streamChat(
  opts: StreamChatOpts,
): AsyncGenerator<ChatChunk> {
  if (opts.provider.schema === "anthropic") {
    yield* streamAnthropic(opts);
  } else {
    yield* streamOpenAICompat(opts);
  }
}

async function* readSSELines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      yield line;
    }
  }
  if (buf.length) yield buf;
}

function classifyHttp(status: number): ChatError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "unknown";
}

async function postOrThrow(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ChatError(
      `网络或 CORS 错误:${msg}。此 provider 可能不允许浏览器直连,可换 provider 或检查网络。`,
      "network",
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    throw new ChatError(
      `HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      classifyHttp(res.status),
      res.status,
    );
  }
  if (!res.body) {
    throw new ChatError("Response 没有 body 流", "unknown");
  }
  return res;
}

async function* streamOpenAICompat(
  opts: StreamChatOpts,
): AsyncGenerator<ChatChunk> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model: opts.model,
    stream: true,
    messages: [
      { role: "system", content: opts.systemPrompt },
      ...opts.messages,
    ],
  });
  const res = await postOrThrow(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body,
    signal: opts.signal,
  });

  for await (const line of readSSELines(res.body!)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      if (payload === "[DONE]") yield { delta: "", done: true };
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta: string = parsed?.choices?.[0]?.delta?.content ?? "";
    if (delta) yield { delta, done: false };
  }
  yield { delta: "", done: true };
}

async function* streamAnthropic(
  opts: StreamChatOpts,
): AsyncGenerator<ChatChunk> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/messages`;
  const body = JSON.stringify({
    model: opts.model,
    stream: true,
    max_tokens: 1024,
    system: opts.systemPrompt,
    messages: opts.messages,
  });
  const res = await postOrThrow(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body,
    signal: opts.signal,
  });

  for await (const line of readSSELines(res.body!)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (parsed.type === "content_block_delta") {
      const delta = parsed?.delta?.text ?? "";
      if (delta) yield { delta, done: false };
    } else if (parsed.type === "message_stop") {
      yield { delta: "", done: true };
      return;
    }
  }
  yield { delta: "", done: true };
}
