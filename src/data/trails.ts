import trailsData from "./trails.json";
import philosophersData from "./philosophers.json";
import type { Philosopher } from "../utils/types";

export interface TrailStep {
  philosopherId: string;
  theoryIndex: number;
  workIndex?: number;
  question_zh: string;
  question_en: string;
  bridge_zh: string;
  bridge_en: string;
}

export interface Trail {
  id: string;
  title_zh: string;
  title_en: string;
  description_zh: string;
  description_en: string;
  steps: TrailStep[];
}

interface RawTrailData {
  trails: Trail[];
}

const philosophers = philosophersData.philosophers as Philosopher[];
const philosopherById = new Map(philosophers.map((p) => [p.id, p]));

export const trails = (trailsData as RawTrailData).trails;
export const trailById = new Map(trails.map((trail) => [trail.id, trail]));

export function registerTrail(trail: Trail): void {
  trailById.set(trail.id, trail);
}

export function validateTrailData(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  if (trails.length !== 3) errors.push(`expected 3 trails, found ${trails.length}`);

  for (const trail of trails) {
    if (seen.has(trail.id)) errors.push(`duplicate trail id: ${trail.id}`);
    seen.add(trail.id);
    if (trail.steps.length < 6 || trail.steps.length > 8) {
      errors.push(`${trail.id}: expected 6-8 steps, found ${trail.steps.length}`);
    }
    for (const [index, step] of trail.steps.entries()) {
      const where = `${trail.id}[${index + 1}]`;
      const philosopher = philosopherById.get(step.philosopherId);
      if (!philosopher) {
        errors.push(`${where}: unknown philosopher ${step.philosopherId}`);
        continue;
      }
      if (
        !Number.isInteger(step.theoryIndex) ||
        step.theoryIndex < 0 ||
        step.theoryIndex >= philosopher.theories_zh.length
      ) {
        errors.push(`${where}: invalid theoryIndex ${step.theoryIndex}`);
      }
      if (step.workIndex !== undefined) {
        if (
          !Number.isInteger(step.workIndex) ||
          step.workIndex < 0 ||
          step.workIndex >= philosopher.works.length
        ) {
          errors.push(`${where}: invalid workIndex ${step.workIndex}`);
        }
      }
      if (!step.question_zh.trim() || !step.question_en.trim()) {
        errors.push(`${where}: missing bilingual question`);
      }
      if (!step.bridge_zh.trim() || !step.bridge_en.trim()) {
        errors.push(`${where}: missing bilingual bridge`);
      }
    }
  }

  return errors;
}

const validationErrors = validateTrailData();
if (validationErrors.length > 0) {
  throw new Error(`[trails] invalid route data:\n${validationErrors.join("\n")}`);
}

export function getTrail(id: string | null | undefined): Trail | null {
  return id ? trailById.get(id) ?? null : null;
}

export function getTrailPhilosopher(step: TrailStep): Philosopher {
  const philosopher = philosopherById.get(step.philosopherId);
  if (!philosopher) throw new Error(`[trails] unknown philosopher ${step.philosopherId}`);
  return philosopher;
}
