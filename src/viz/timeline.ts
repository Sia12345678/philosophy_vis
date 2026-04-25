import { store } from "../utils/store";
import { formatYear } from "../utils/i18n";
import waypointsData from "../data/waypoints.json";

interface Waypoint {
  year: number;
  lng: number;
  lat: number;
  scale: number;
  note_zh: string;
}

const WAYPOINTS = waypointsData.waypoints as Waypoint[];
// Years per second when auto-playing
const YEARS_PER_SEC = 80;

export function initTimeline(): void {
  const slider = document.getElementById("timeline") as HTMLInputElement | null;
  const yearLabel = document.getElementById("year-label");
  const playBtn = document.getElementById("play") as HTMLButtonElement | null;
  const ticksEl = document.querySelector(".timeline-ticks");

  if (!slider || !yearLabel || !playBtn) {
    console.warn("[timeline] missing DOM nodes");
    return;
  }

  if (ticksEl) {
    ticksEl.innerHTML = "";
    const years = [-600, -200, 200, 600, 1000, 1400, 1800, 2000];
    for (const y of years) {
      const span = document.createElement("span");
      span.textContent = y < 0 ? `${-y} BCE` : `${y} CE`;
      ticksEl.appendChild(span);
    }
  }

  slider.value = String(store.get("year"));
  yearLabel.textContent = formatYear(store.get("year"));

  slider.addEventListener("input", () => {
    const y = Number(slider.value);
    store.set({ year: y });
    // Manual scrub exits cinematic
    cinematicMode = false;
    lastWaypointIdx = -2;
  });

  store.subscribe((s, prev) => {
    if (s.year !== prev.year) {
      slider.value = String(s.year);
      yearLabel.textContent = formatYear(s.year);
    }
    if (s.isPlaying !== prev.isPlaying) {
      playBtn.classList.toggle("playing", s.isPlaying);
    }
  });

  let rafId: number | null = null;
  let lastTs = 0;
  let cinematicMode = false;
  let lastWaypointIdx = -2;

  // User pan/zoom during autoplay → exit cinematic but keep time advancing
  window.addEventListener("camera:user-exit", () => {
    if (cinematicMode) {
      cinematicMode = false;
    }
  });

  function dispatchCameraForYear(year: number): void {
    if (!cinematicMode) return;
    // Find segment: largest waypoint with wp.year <= year
    let idx = -1;
    for (let i = 0; i < WAYPOINTS.length; i++) {
      if (WAYPOINTS[i].year <= year) idx = i;
    }
    if (idx === lastWaypointIdx) return;
    lastWaypointIdx = idx;

    if (idx < 0) idx = 0;
    const next = WAYPOINTS[idx + 1];
    const target = next ?? WAYPOINTS[idx];
    const remaining =
      next != null ? Math.max(next.year - year, 1) : 1;
    const durationMs = (remaining / YEARS_PER_SEC) * 1000;

    window.dispatchEvent(
      new CustomEvent("camera:target", {
        detail: {
          lng: target.lng,
          lat: target.lat,
          scale: target.scale,
          durationMs,
        },
      }),
    );
  }

  function tick(ts: number): void {
    if (!store.get("isPlaying")) {
      rafId = null;
      return;
    }
    if (lastTs === 0) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    const next = store.get("year") + (dt / 1000) * YEARS_PER_SEC;
    if (next >= 2000) {
      store.set({ year: 2000, isPlaying: false });
      cinematicMode = false;
    } else {
      const newYear = Math.round(next);
      store.set({ year: newYear });
      dispatchCameraForYear(newYear);
      rafId = requestAnimationFrame(tick);
    }
  }

  playBtn.addEventListener("click", () => {
    const playing = store.get("isPlaying");
    if (playing) {
      store.set({ isPlaying: false });
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = 0;
      cinematicMode = false;
    } else {
      if (store.get("year") >= 2000) store.set({ year: -600 });
      store.set({ isPlaying: true });
      lastTs = 0;
      cinematicMode = true;
      lastWaypointIdx = -2;
      // Fire initial camera target immediately
      dispatchCameraForYear(store.get("year"));
      rafId = requestAnimationFrame(tick);
    }
  });
}
