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
// Years per second when auto-playing (at 1× speed)
const YEARS_PER_SEC = 80;
const MIN_YEAR = -600;
const MAX_YEAR = 2000;

export function initTimeline(): void {
  const slider = document.getElementById("timeline") as HTMLInputElement | null;
  const yearLabel = document.getElementById("year-label");
  const playBtn = document.getElementById("play") as HTMLButtonElement | null;
  const ticksEl = document.querySelector(".timeline-ticks");
  const speedSelect = document.getElementById(
    "speed-select",
  ) as HTMLSelectElement | null;
  const loopStartHandle = document.querySelector<HTMLButtonElement>(
    ".loop-handle-start",
  );
  const loopEndHandle = document.querySelector<HTMLButtonElement>(
    ".loop-handle-end",
  );
  const loopBand = document.querySelector<HTMLElement>(".loop-band");
  const timelineWrap = document.querySelector<HTMLElement>(".timeline-wrap");

  if (!slider || !yearLabel || !playBtn) {
    console.warn("[timeline] missing DOM nodes");
    return;
  }

  function yearToPercent(y: number): number {
    return ((y - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;
  }

  function updateLoopVisuals(): void {
    const ls = store.get("loopStart");
    const le = store.get("loopEnd");
    const lsPct = yearToPercent(ls);
    const lePct = yearToPercent(le);
    if (loopStartHandle) loopStartHandle.style.left = `${lsPct}%`;
    if (loopEndHandle) loopEndHandle.style.left = `${lePct}%`;
    if (loopBand) {
      loopBand.style.left = `${lsPct}%`;
      loopBand.style.width = `${Math.max(0, lePct - lsPct)}%`;
    }
  }

  function attachLoopHandle(
    handle: HTMLButtonElement | null,
    isStart: boolean,
  ): void {
    if (!handle || !timelineWrap) return;
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const rect = timelineWrap.getBoundingClientRect();
        const pct = Math.max(
          0,
          Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100),
        );
        let y = Math.round(MIN_YEAR + (pct / 100) * (MAX_YEAR - MIN_YEAR));
        if (isStart) {
          const end = store.get("loopEnd");
          if (y >= end) y = end - 1;
          y = Math.max(MIN_YEAR, y);
          store.set({ loopStart: y });
        } else {
          const start = store.get("loopStart");
          if (y <= start) y = start + 1;
          y = Math.min(MAX_YEAR, y);
          store.set({ loopEnd: y });
        }
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });

    handle.addEventListener("dblclick", () => {
      if (isStart) store.set({ loopStart: MIN_YEAR });
      else store.set({ loopEnd: MAX_YEAR });
    });
  }

  attachLoopHandle(loopStartHandle, true);
  attachLoopHandle(loopEndHandle, false);
  updateLoopVisuals();

  if (speedSelect) {
    speedSelect.addEventListener("change", () => {
      const v = Number(speedSelect.value);
      if (!Number.isNaN(v) && v > 0) store.set({ playbackSpeed: v });
    });
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
    if (cinematicMode) {
      cinematicMode = false;
      window.dispatchEvent(new CustomEvent("cinematic:end"));
    }
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
    if (s.loopStart !== prev.loopStart || s.loopEnd !== prev.loopEnd) {
      updateLoopVisuals();
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
          note: target.note_zh,
          targetYear: target.year,
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
    const speed = store.get("playbackSpeed");
    const ls = store.get("loopStart");
    const le = store.get("loopEnd");
    const isSubrange = ls > MIN_YEAR || le < MAX_YEAR;
    const next = store.get("year") + (dt / 1000) * YEARS_PER_SEC * speed;

    if (next >= le) {
      if (isSubrange) {
        // Loop back to start of selected range; re-arm camera
        store.set({ year: ls });
        lastWaypointIdx = -2;
        if (cinematicMode) dispatchCameraForYear(ls);
      } else {
        store.set({ year: MAX_YEAR, isPlaying: false });
        cinematicMode = false;
        window.dispatchEvent(new CustomEvent("cinematic:end"));
        return;
      }
    } else {
      const newYear = Math.round(next);
      store.set({ year: newYear });
      dispatchCameraForYear(newYear);
    }
    rafId = requestAnimationFrame(tick);
  }

  playBtn.addEventListener("click", () => {
    const playing = store.get("isPlaying");
    if (playing) {
      store.set({ isPlaying: false });
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = 0;
      if (cinematicMode) {
        cinematicMode = false;
        window.dispatchEvent(new CustomEvent("cinematic:end"));
      }
    } else {
      const ls = store.get("loopStart");
      const le = store.get("loopEnd");
      const y = store.get("year");
      // Snap into range if currently outside
      if (y < ls || y >= le) store.set({ year: ls });
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
