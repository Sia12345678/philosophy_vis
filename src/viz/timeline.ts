import { store } from "../utils/store";
import { formatYear } from "../utils/i18n";

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

  function tick(ts: number): void {
    if (!store.get("isPlaying")) {
      rafId = null;
      return;
    }
    if (lastTs === 0) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    // 80 years per second
    const next = store.get("year") + dt * 0.08;
    if (next >= 2000) {
      store.set({ year: 2000, isPlaying: false });
    } else {
      store.set({ year: Math.round(next) });
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
    } else {
      if (store.get("year") >= 2000) store.set({ year: -600 });
      store.set({ isPlaying: true });
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    }
  });
}
