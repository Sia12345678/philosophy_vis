import type { Trail, TrailStep } from "../data/trails";
import type { Philosopher } from "./types";

export type PlannerPhilosopher = Pick<
  Philosopher,
  | "id"
  | "name_zh"
  | "name_en"
  | "birth"
  | "death"
  | "schools"
  | "theories_zh"
  | "theories_en"
>;

interface PlannerCatalogEntry {
  id: string;
  zh: string;
  en: string;
  years: string;
  schools: string[];
  theories: Array<{ i: number; zh: string; en: string }>;
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function compactCatalog(philosophers: PlannerPhilosopher[]): PlannerCatalogEntry[] {
  return philosophers.map((philosopher) => ({
    id: philosopher.id,
    zh: philosopher.name_zh,
    en: philosopher.name_en,
    years: `${formatYear(philosopher.birth)}–${formatYear(philosopher.death)}`,
    schools: philosopher.schools,
    theories: philosopher.theories_zh.map((theoryZh, index) => ({
      i: index,
      zh: theoryZh,
      en: philosopher.theories_en[index] ?? "",
    })),
  }));
}

export function buildPlannerSystemPrompt(
  philosophers: PlannerPhilosopher[],
): string {
  return `你是「哲学家星图」的课程策展人。用户会提出一个或多个问题。你要从下面唯一可用的哲学家目录中，选择 6–8 位，规划一条真正回应用户问题的思想路线。

规则：
1. 先识别问题中的核心张力、前提和隐含假设，再选择能提供不同视角的哲学家。不要拼凑名人，也不要每次都选同一组人。
2. 路线必须有递进关系：后一站应回应、反驳或重新框定前一站留下的小问题。不要声称存在师承关系，也不要伪造引文、著作或历史事实。
3. 用户可能提出私人困境、技术、工作、政治或生活问题。把它转译为可讨论的哲学问题，但不要说教、诊断或给廉价鸡汤。
4. 每位哲学家只能出现一次。theoryIndex 必须严格使用目录中该哲学家的理论下标。
5. 每一站的 question_zh 是一句 12–60 字的中文问题，question_en 是自然的英文对应句。问题要推动下一步思考，不要重复用户原问题。
6. 标题简短、有方向感，不要写成百科条目。description 用一两句话说明这条路线如何接近用户的问题。
7. 只输出合法 JSON，不要 Markdown、代码围栏、解释或前后缀。JSON 结构必须是：
{"title_zh":"...","title_en":"...","description_zh":"...","description_en":"...","steps":[{"philosopherId":"...","theoryIndex":0,"question_zh":"...","question_en":"..."}]}

哲学家目录（JSON）：
${JSON.stringify(compactCatalog(philosophers))}`;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function shortQuestion(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  const characters = Array.from(compact);
  return characters.length > 32 ? `${characters.slice(0, 32).join("")}…` : compact;
}

function extractJson(text: string): string {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model did not return a JSON object");
  return trimmed.slice(start, end + 1);
}

function readText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new Error(`missing ${field}`);
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`empty ${field}`);
  return Array.from(text).slice(0, maxLength).join("");
}

function readOptionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  return readText(value, field, maxLength);
}

export function buildTrailFromPlan(
  rawPlan: string,
  question: string,
  philosophers: PlannerPhilosopher[],
): Trail {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(rawPlan));
  } catch (error) {
    throw new Error(
      error instanceof Error ? `invalid model JSON: ${error.message}` : "invalid model JSON",
    );
  }
  if (!parsed || typeof parsed !== "object") throw new Error("model plan is not an object");

  const plan = parsed as Record<string, unknown>;
  if (!Array.isArray(plan.steps)) throw new Error("model plan has no steps");
  if (plan.steps.length < 6 || plan.steps.length > 8) {
    throw new Error(`model returned ${plan.steps.length} steps; expected 6-8`);
  }

  const philosopherById = new Map(philosophers.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const steps: TrailStep[] = [];
  for (const [index, value] of plan.steps.entries()) {
    if (!value || typeof value !== "object") {
      throw new Error(`step ${index + 1} is not an object`);
    }
    const step = value as Record<string, unknown>;
    const philosopherId = readText(step.philosopherId, "philosopherId", 80);
    const philosopher = philosopherById.get(philosopherId);
    if (!philosopher) throw new Error(`unknown philosopher ${philosopherId}`);
    if (seen.has(philosopherId)) continue;
    seen.add(philosopherId);

    const theoryIndex = Number(step.theoryIndex);
    if (
      !Number.isInteger(theoryIndex) ||
      theoryIndex < 0 ||
      theoryIndex >= philosopher.theories_zh.length
    ) {
      throw new Error(`invalid theoryIndex for ${philosopherId}`);
    }

    const questionZh = readText(step.question_zh, "question_zh", 180);
    const questionEn = readOptionalText(step.question_en, "question_en", 240) || questionZh;
    steps.push({
      philosopherId,
      theoryIndex,
      question_zh: questionZh,
      question_en: questionEn,
      bridge_zh: "",
      bridge_en: "",
    });
  }
  if (steps.length < 6) {
    throw new Error(
      `model returned ${steps.length} unique philosophers; expected 6-8`,
    );
  }

  const compactQuestion = shortQuestion(question);
  return {
    id: `custom-${hashText(question)}`,
    title_zh:
      readOptionalText(plan.title_zh, "title_zh", 60) ||
      `关于「${compactQuestion}」的思想路线`,
    title_en:
      readOptionalText(plan.title_en, "title_en", 100) ||
      `A philosophical trail: “${compactQuestion}”`,
    description_zh:
      readOptionalText(plan.description_zh, "description_zh", 240) ||
      "从你写下的问题出发，由模型从现有哲学家中选出不同视角，组成一条可以走完的思考路线。",
    description_en:
      readOptionalText(plan.description_en, "description_en", 360) ||
      "Starting from your question, a model selects distinct philosophical perspectives into a route you can walk through.",
    steps,
  };
}
