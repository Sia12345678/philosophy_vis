import type { Trail } from "../data/trails";

export const TRAIL_PROGRESS_VERSION = 1 as const;
export const TRAIL_PROGRESS_KEY = "philosophy_vis_trail_progress_v1";

export interface RecentTrailVisit {
  trailId: string;
  step: number;
  visitedAt: number;
}

export interface TrailProgress {
  version: typeof TRAIL_PROGRESS_VERSION;
  currentTrailId: string | null;
  currentStep: number;
  completedTrailIds: string[];
  recent: RecentTrailVisit[];
  introDismissed: boolean;
  updatedAt: number;
}

export function defaultTrailProgress(): TrailProgress {
  return {
    version: TRAIL_PROGRESS_VERSION,
    currentTrailId: null,
    currentStep: 1,
    completedTrailIds: [],
    recent: [],
    introDismissed: false,
    updatedAt: Date.now(),
  };
}

function trailMap(trails: Trail[]): Map<string, Trail> {
  return new Map(trails.map((trail) => [trail.id, trail]));
}

function validStep(trail: Trail | undefined, step: unknown, fallback = 1): number {
  if (!trail) return 1;
  const value = typeof step === "number" ? Math.floor(step) : Number.NaN;
  return Number.isFinite(value) && value >= 1 && value <= trail.steps.length
    ? value
    : Math.min(Math.max(1, fallback), trail.steps.length);
}

export function normalizeTrailProgress(
  value: unknown,
  trails: Trail[],
): TrailProgress | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<TrailProgress>;
  if (raw.version !== TRAIL_PROGRESS_VERSION) return null;

  const byId = trailMap(trails);
  const currentTrailId =
    typeof raw.currentTrailId === "string" && byId.has(raw.currentTrailId)
      ? raw.currentTrailId
      : null;
  const currentTrail = currentTrailId ? byId.get(currentTrailId) : undefined;
  const currentStep = currentTrailId
    ? validStep(currentTrail, raw.currentStep)
    : 1;

  const completedTrailIds = Array.isArray(raw.completedTrailIds)
    ? [...new Set(raw.completedTrailIds.filter((id): id is string => typeof id === "string" && byId.has(id)))]
    : [];

  const recent = Array.isArray(raw.recent)
    ? raw.recent
        .filter((visit): visit is RecentTrailVisit => {
          if (!visit || typeof visit !== "object") return false;
          const candidate = visit as Partial<RecentTrailVisit>;
          return (
            typeof candidate.trailId === "string" &&
            byId.has(candidate.trailId) &&
            typeof candidate.step === "number" &&
            typeof candidate.visitedAt === "number"
          );
        })
        .map((visit) => ({
          trailId: visit.trailId,
          step: validStep(byId.get(visit.trailId), visit.step),
          visitedAt: Math.max(0, Math.floor(visit.visitedAt)),
        }))
        .slice(-6)
    : [];

  return {
    version: TRAIL_PROGRESS_VERSION,
    currentTrailId,
    currentStep,
    completedTrailIds,
    recent,
    introDismissed: raw.introDismissed === true,
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? Math.max(0, Math.floor(raw.updatedAt))
        : Date.now(),
  };
}

export function loadTrailProgress(trails: Trail[]): TrailProgress {
  try {
    const raw = localStorage.getItem(TRAIL_PROGRESS_KEY);
    if (!raw) return defaultTrailProgress();
    return (
      normalizeTrailProgress(JSON.parse(raw), trails) ??
      defaultTrailProgress()
    );
  } catch {
    return defaultTrailProgress();
  }
}

export function saveTrailProgress(progress: TrailProgress): void {
  try {
    localStorage.setItem(TRAIL_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* Storage can be unavailable in private or restricted contexts. */
  }
}

export function clearStoredTrailProgress(): void {
  try {
    localStorage.removeItem(TRAIL_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

export function exportTrailProgress(progress: TrailProgress): string {
  return JSON.stringify(progress, null, 2);
}

export function importTrailProgress(
  text: string,
  trails: Trail[],
): TrailProgress {
  return (
    normalizeTrailProgress(JSON.parse(text), trails) ?? (() => {
      throw new Error("unsupported or invalid trail progress");
    })()
  );
}

export function visitTrail(
  progress: TrailProgress,
  trail: Trail,
  step: number,
): TrailProgress {
  const nextStep = validStep(trail, step);
  const recent = progress.recent.filter((visit) => visit.trailId !== trail.id);
  recent.push({ trailId: trail.id, step: nextStep, visitedAt: Date.now() });
  return {
    ...progress,
    currentTrailId: trail.id,
    currentStep: nextStep,
    recent: recent.slice(-6),
    updatedAt: Date.now(),
  };
}
