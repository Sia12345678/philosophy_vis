import philosophersData from "../data/philosophers.json";
import type { Trail } from "../data/trails";
import { checkedBaseUrl } from "../chat/baseUrl";
import { getProvider, loadSettings, type ChatSettings } from "../chat/providers";
import { redactSecrets } from "../chat/redact";
import {
  buildPlannerSystemPrompt,
  buildTrailFromPlan,
  type PlannerPhilosopher,
} from "./modelTrailSchema";

const philosophers = philosophersData.philosophers as PlannerPhilosopher[];
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TOKENS = 2400;

type PlannerMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelTrailErrorKind =
  | "settings"
  | "config"
  | "auth"
  | "rate"
  | "network"
  | "server"
  | "invalid"
  | "timeout"
  | "unknown";

export class ModelTrailError extends Error {
  constructor(
    message: string,
    public kind: ModelTrailErrorKind = "unknown",
    public status?: number,
  ) {
    super(message);
  }
}

let cachedSystemPrompt = "";

function plannerSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = buildPlannerSystemPrompt(philosophers);
  }
  return cachedSystemPrompt;
}

function classifyStatus(status: number): ModelTrailErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "config";
}

async function responseDetail(response: Response, apiKey: string): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const error = parsed.error;
      if (typeof error === "string") return redactSecrets(error, apiKey).slice(0, 240);
      if (error && typeof error === "object") {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string") {
          return redactSecrets(message, apiKey).slice(0, 240);
        }
      }
      if (typeof parsed.message === "string") {
        return redactSecrets(parsed.message, apiKey).slice(0, 240);
      }
    } catch {
      /* Not JSON. */
    }
    return redactSecrets(text, apiKey).slice(0, 240);
  } catch {
    return "";
  }
}

function errorForStatus(status: number, detail: string): ModelTrailError {
  const kind = classifyStatus(status);
  const suffix = detail ? `：${detail}` : "";
  if (kind === "auth") {
    return new ModelTrailError(`API Key 无效、已撤销或没有该模型权限${suffix}`, kind, status);
  }
  if (kind === "rate") {
    return new ModelTrailError(`请求过频或额度不足，请稍后再试${suffix}`, kind, status);
  }
  if (kind === "server") {
    return new ModelTrailError(`模型服务暂时出错，请稍后重试${suffix}`, kind, status);
  }
  if (status === 404) {
    return new ModelTrailError(`Base URL 或模型名不正确（HTTP 404）${suffix}`, kind, status);
  }
  return new ModelTrailError(`模型请求被拒绝（HTTP ${status}）${suffix}`, kind, status);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .join("");
}

function completionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.response === "string") return data.response;

  const choices = data.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const text = contentText(message?.content);
    if (text) return text;
    if (typeof first?.text === "string") return first.text;
  }

  return contentText(data.content);
}

async function requestCompletion(
  settings: ChatSettings,
  messages: PlannerMessage[],
  signal: AbortSignal,
  temperature: number,
): Promise<string> {
  const provider = getProvider(settings.providerId);
  if (!provider) {
    throw new ModelTrailError("模型 provider 配置无效，请重新连接。", "settings");
  }
  let baseUrl: string;
  try {
    baseUrl = checkedBaseUrl(settings.baseUrl);
  } catch (error) {
    throw new ModelTrailError(
      error instanceof Error ? error.message : "Base URL 配置无效。",
      "config",
    );
  }
  const isAnthropic = provider.schema === "anthropic";
  const url = isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
  const body = isAnthropic
    ? {
        model: settings.model,
        max_tokens: MAX_TOKENS,
        temperature,
        system: messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n"),
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role, content: message.content })),
      }
    : {
        model: settings.model,
        stream: false,
        max_tokens: MAX_TOKENS,
        temperature,
        messages,
      };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isAnthropic) {
    headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ModelTrailError("模型思考超时了，请重新提问。", "timeout");
    }
    throw new ModelTrailError(
      "浏览器无法直连该模型 API，可能是 CORS 或网络限制。请换一个 provider，或填写支持浏览器访问的 Base URL。",
      "network",
    );
  }

  if (!response.ok) {
    throw errorForStatus(
      response.status,
      await responseDetail(response, settings.apiKey),
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ModelTrailError("模型返回了无法读取的响应。", "invalid", response.status);
  }
  const text = completionText(payload);
  if (!text.trim()) {
    throw new ModelTrailError("模型没有返回路线内容。", "invalid", response.status);
  }
  return text;
}

export async function requestModelTrail(question: string): Promise<Trail> {
  const settings = loadSettings();
  if (!settings) {
    throw new ModelTrailError("请先连接你自己的模型 API。", "settings");
  }

  const messages: PlannerMessage[] = [
    { role: "system", content: plannerSystemPrompt() },
    {
      role: "user",
      content: `用户问题：${question}\n\n请规划一条 7 站路线。严格从目录中选择，并按你认为最有助于思考的顺序排列。`,
    },
  ];
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const firstPlan = await requestCompletion(settings, messages, controller.signal, 0.35);
    try {
      return buildTrailFromPlan(firstPlan, question, philosophers);
    } catch (firstError) {
      const repairMessages: PlannerMessage[] = [
        ...messages,
        { role: "assistant", content: firstPlan.slice(0, 8000) },
        {
          role: "user",
          content: `上一条路线未通过结构校验：${firstError instanceof Error ? firstError.message : "unknown error"}。

请修复并重新输出完整 JSON。硬性要求：
1. philosopherId 必须逐字复制目录中的 id，不能使用目录外的哲学家。
2. theoryIndex 必须是该哲学家理论列表中真实存在的下标。
3. 必须包含 6–8 位不同哲学家，每位只出现一次。
4. 只输出修正后的 JSON，不要解释、Markdown 或代码围栏。`,
        },
      ];
      const repairedPlan = await requestCompletion(
        settings,
        repairMessages,
        controller.signal,
        0.15,
      );
      try {
        return buildTrailFromPlan(repairedPlan, question, philosophers);
      } catch {
        throw new ModelTrailError("模型返回的路线不完整，请重新提问。", "invalid");
      }
    }
  } finally {
    window.clearTimeout(timeout);
  }
}
