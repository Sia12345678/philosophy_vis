import philosophersData from "../src/data/philosophers.json";
import {
  buildPlannerSystemPrompt,
  buildTrailFromPlan,
  type PlannerPhilosopher,
} from "../src/utils/modelTrailSchema";

interface Env {
  AI?: {
    run(
      model: string,
      inputs: Record<string, unknown>,
    ): Promise<unknown>;
  };
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  TRAIL_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  PLANNER_DEBUG?: string;
}

const philosophers = philosophersData.philosophers as PlannerPhilosopher[];
const systemPrompt = buildPlannerSystemPrompt(philosophers);
const defaultModel = "@cf/zai-org/glm-4.7-flash";
const requestBuckets = new Map<string, number[]>();
const rateWindowMs = 10 * 60 * 1000;
const rateLimit = 8;

function defaultAllowedOrigins(): string[] {
  return [
    "https://sia12345678.github.io",
    "https://wherephilosophygoes.ucfnshu.workers.dev",
  ];
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  if (!origin) return true;
  if (defaultAllowedOrigins().includes(origin)) return true;
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return (
      (protocol === "http:" || protocol === "https:") &&
      (hostname === "127.0.0.1" || hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function corsHeaders(origin: string, env: Env): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  origin: string,
  env: Env,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin, env),
      ...extraHeaders,
    },
  });
}

function withinRateLimit(ip: string): boolean {
  const now = Date.now();
  if (requestBuckets.size > 5000) requestBuckets.clear();
  const recent = (requestBuckets.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < rateWindowMs,
  );
  if (recent.length >= rateLimit) {
    requestBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  requestBuckets.set(ip, recent);
  return true;
}

function responseText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const data = result as Record<string, unknown>;
  if (typeof data.response === "string") return data.response;
  const choices = data.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        })
        .join("");
    }
  }
  return "";
}

async function planTrail(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  if (!withinRateLimit(request.headers.get("cf-connecting-ip") ?? "unknown")) {
    return json(
      { error: "rate_limited", message: "提问太频繁，请稍后再试。" },
      429,
      origin,
      env,
      { "Retry-After": "600" },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400, origin, env);
  }
  if (!body || typeof body !== "object") {
    return json({ error: "invalid_request" }, 400, origin, env);
  }

  const rawQuestion = (body as Record<string, unknown>).question;
  if (typeof rawQuestion !== "string") {
    return json({ error: "invalid_request" }, 400, origin, env);
  }
  const question = rawQuestion.replace(/\s+/g, " ").trim();
  const questionLength = Array.from(question).length;
  if (questionLength < 2 || questionLength > 300) {
    return json(
      { error: "invalid_question", message: "问题长度需要在 2–300 字之间。" },
      400,
      origin,
      env,
    );
  }

  if (!env.AI || typeof env.AI.run !== "function") {
    return json(
      { error: "model_unavailable", message: "模型服务尚未配置。" },
      503,
      origin,
      env,
    );
  }

  let result: unknown;
  try {
    result = await env.AI.run(env.TRAIL_MODEL || defaultModel, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `用户问题：${question}\n\n请规划一条 7 站路线。严格从目录中选择，并按你认为最有助于思考的顺序排列。`,
        },
      ],
      temperature: 0.35,
      max_tokens: 2400,
      reasoning_effort: null,
      chat_template_kwargs: { enable_thinking: false },
    });
  } catch (error) {
    console.error("[plan-trail] model call failed", error);
    return json(
      { error: "model_failed", message: "模型暂时无法规划路线，请稍后重试。" },
      502,
      origin,
      env,
    );
  }

  const rawPlan = responseText(result);
  if (!rawPlan) {
    console.error("[plan-trail] empty model response", result);
    return json(
      { error: "empty_model_response", message: "模型没有返回可用的路线。" },
      502,
      origin,
      env,
    );
  }

  try {
    const trail = buildTrailFromPlan(rawPlan, question, philosophers);
    return json({ trail }, 200, origin, env);
  } catch (error) {
    console.error("[plan-trail] invalid model plan", error, rawPlan.slice(0, 1200));
    return json(
      {
        error: "invalid_model_plan",
        message: "模型返回的路线不完整，请重新提问。",
        detail: error instanceof Error ? error.message : "unknown validation error",
        ...(env.PLANNER_DEBUG === "1" ? { debug: rawPlan.slice(0, 6000) } : {}),
      },
      502,
      origin,
      env,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";

    if (url.pathname === "/api/plan-trail") {
      if (request.method === "OPTIONS") {
        if (!isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: corsHeaders(origin, env),
        });
      }
      if (!isAllowedOrigin(origin, env)) return new Response("Forbidden", { status: 403 });
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, origin, env, {
          Allow: "POST, OPTIONS",
        });
      }
      return planTrail(request, env, origin);
    }

    return env.ASSETS.fetch(request);
  },
};
