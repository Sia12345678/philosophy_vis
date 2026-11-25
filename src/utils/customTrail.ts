import philosophersData from "../data/philosophers.json";
import type { Philosopher } from "../utils/types";
import type { Trail, TrailStep } from "../data/trails";

const STORAGE_KEY = "philosophy_vis_custom_trail_v2";
const LEGACY_STORAGE_KEYS = ["philosophy_vis_custom_trail_v1"];
const STORAGE_VERSION = 2;
const GENERATOR = "model-v1";
const philosopherIds = new Set(
  (philosophersData.philosophers as Philosopher[]).map((philosopher) => philosopher.id),
);

function isStep(value: unknown): value is TrailStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<TrailStep>;
  return (
    typeof step.philosopherId === "string" &&
    philosopherIds.has(step.philosopherId) &&
    Number.isInteger(step.theoryIndex) &&
    (step.theoryIndex ?? -1) >= 0 &&
    typeof step.question_zh === "string" &&
    typeof step.question_en === "string" &&
    typeof step.bridge_zh === "string" &&
    typeof step.bridge_en === "string"
  );
}

function isTrail(value: unknown): value is Trail {
  if (!value || typeof value !== "object") return false;
  const trail = value as Partial<Trail>;
  return (
    typeof trail.id === "string" &&
    trail.id.startsWith("custom-") &&
    typeof trail.title_zh === "string" &&
    typeof trail.title_en === "string" &&
    typeof trail.description_zh === "string" &&
    typeof trail.description_en === "string" &&
    Array.isArray(trail.steps) &&
    trail.steps.length >= 5 &&
    trail.steps.length <= 9 &&
    trail.steps.every(isStep)
  );
}

export function loadCustomTrail(): Trail | null {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const stored = parsed as Record<string, unknown>;
    if (stored.version !== STORAGE_VERSION || stored.generator !== GENERATOR) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return isTrail(stored.trail) ? stored.trail : null;
  } catch {
    return null;
  }
}

export function saveCustomTrail(trail: Trail): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, generator: GENERATOR, trail }),
    );
  } catch {
    /* ignore */
  }
}
