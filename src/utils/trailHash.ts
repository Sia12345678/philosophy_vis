export interface AppHashState {
  record: boolean;
  trailId: string | null;
  step: number | null;
}

export function parseAppHash(hash = window.location.hash): AppHashState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const trailId = params.get("trail")?.trim() || null;
  const rawStep = params.get("step");
  const parsedStep = rawStep === null ? null : Number.parseInt(rawStep, 10);
  return {
    record: params.has("record"),
    trailId,
    step:
      Number.isFinite(parsedStep) && parsedStep !== null && parsedStep > 0
        ? parsedStep
        : null,
  };
}

function buildHash(state: AppHashState): string {
  const parts: string[] = [];
  if (state.record) parts.push("record");
  if (state.trailId) {
    parts.push(`trail=${encodeURIComponent(state.trailId)}`);
    if (state.step !== null && state.step > 0) {
      parts.push(`step=${Math.floor(state.step)}`);
    }
  }
  return parts.length ? `#${parts.join("&")}` : "";
}

export function updateAppHash(
  patch: Partial<AppHashState>,
  mode: "replace" | "push" = "replace",
): void {
  const next = { ...parseAppHash(), ...patch };
  if (!next.trailId) next.step = null;
  const hash = buildHash(next);
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

export function linkForTrail(trailId: string, step: number): string {
  const url = new URL(window.location.href);
  url.hash = buildHash({
    record: parseAppHash(url.hash).record,
    trailId,
    step,
  }).slice(1);
  return url.toString();
}
