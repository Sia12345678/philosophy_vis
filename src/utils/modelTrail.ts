import philosophersData from "../data/philosophers.json";
import type { Trail, TrailStep } from "../data/trails";
import type { Philosopher } from "./types";

const philosophers = philosophersData.philosophers as Philosopher[];
const philosopherById = new Map(philosophers.map((p) => [p.id, p]));
const remotePlannerUrl =
  "https://wherephilosophygoes.ucfnshu.workers.dev/api/plan-trail";

export class ModelTrailError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function plannerEndpoint(): string {
  const configured = import.meta.env.VITE_TRAIL_API_URL?.trim();
  if (configured) return configured;
  const hostname = window.location.hostname;
  if (hostname.endsWith(".workers.dev")) {
    return "/api/plan-trail";
  }
  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return "/api/plan-trail";
  }
  return remotePlannerUrl;
}

function isStep(value: unknown): value is TrailStep & { philosopherId: string } {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  if (typeof step.philosopherId !== "string") return false;
  const philosopher = philosopherById.get(step.philosopherId);
  if (!philosopher) return false;
  const theoryIndex = Number(step.theoryIndex);
  return (
    Number.isInteger(theoryIndex) &&
    theoryIndex >= 0 &&
    theoryIndex < philosopher.theories_zh.length &&
    typeof step.question_zh === "string" &&
    step.question_zh.trim().length > 0 &&
    typeof step.question_en === "string" &&
    step.question_en.trim().length > 0
  );
}

function validateTrail(value: unknown): Trail {
  if (!value || typeof value !== "object") throw new ModelTrailError("模型没有返回路线。");
  const trail = value as Record<string, unknown>;
  if (
    typeof trail.id !== "string" ||
    !trail.id.startsWith("custom-") ||
    typeof trail.title_zh !== "string" ||
    typeof trail.title_en !== "string" ||
    typeof trail.description_zh !== "string" ||
    typeof trail.description_en !== "string" ||
    !Array.isArray(trail.steps) ||
    trail.steps.length < 6 ||
    trail.steps.length > 8 ||
    !trail.steps.every(isStep)
  ) {
    throw new ModelTrailError("模型返回的路线不完整，请重新提问。");
  }
  return trail as unknown as Trail;
}

async function messageForResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  } catch {
    /* ignore */
  }
  if (response.status === 429) return "提问太频繁，请过几分钟再试。";
  if (response.status === 503) return "模型服务暂时不可用，请稍后再试。";
  if (response.status >= 500) return "模型暂时没能完成这条路线，请重新提问。";
  return "模型暂时没能规划路线，请稍后重试。";
}

export async function requestModelTrail(question: string): Promise<Trail> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  try {
    response = await fetch(plannerEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelTrailError("模型思考超时了，请重新提问。");
    }
    throw new ModelTrailError("无法连接路线规划服务，请检查网络后重试。");
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ModelTrailError(await messageForResponse(response), response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ModelTrailError("路线规划服务返回了无法读取的结果。");
  }
  const trail = (body as { trail?: unknown } | null)?.trail;
  return validateTrail(trail);
}
