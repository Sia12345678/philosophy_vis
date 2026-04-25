import "./styles.css";
import { initMap } from "./viz/map";
import { initTimeline } from "./viz/timeline";
import { initTooltip } from "./viz/tooltip";
import { initSidebar } from "./viz/sidebar";
import { initLineage } from "./viz/lineage";
import { initFilterBar } from "./ui/filterBar";
import { initCinematicCaption } from "./ui/cinematicCaption";
import { store } from "./utils/store";

async function bootstrap(): Promise<void> {
  const mapRoot = document.getElementById("map-root");
  if (!mapRoot) {
    console.error("[main] no #map-root");
    return;
  }

  initTimeline();
  initTooltip();
  initSidebar();
  initFilterBar();
  initCinematicCaption();
  await initMap(mapRoot);
  initLineage();

  // Wire up search
  const search = document.getElementById("search") as HTMLInputElement | null;
  if (search) {
    search.addEventListener("input", () => {
      store.set({ searchQuery: search.value });
    });
  }

  // Wire up lineage toggle (placeholder for Phase 3)
  const lineageToggle = document.getElementById(
    "toggle-lineage",
  ) as HTMLInputElement | null;
  if (lineageToggle) {
    lineageToggle.addEventListener("change", () => {
      store.set({ showLineage: lineageToggle.checked });
    });
  }

  // ---- Record mode: URL hash #record toggles a one-shot social-media layout ----
  const stageEl = document.querySelector(".stage") as HTMLElement | null;
  function fmtYear(y: number): string {
    if (y < 0) return `${Math.abs(y)} BCE`;
    if (y === 0) return "1 CE";
    return `${y} CE`;
  }
  function applyRecordMode(): void {
    const isRecord = window.location.hash === "#record";
    document.body.classList.toggle("record-mode", isRecord);
    if (isRecord) {
      // Push current year onto stage data-year, keep updating
      if (stageEl) stageEl.setAttribute("data-year", fmtYear(store.get("year")));
      // Auto-start cinematic after layout settles
      window.setTimeout(() => {
        if (!store.get("isPlaying")) {
          (document.getElementById("play") as HTMLButtonElement | null)?.click();
        }
      }, 600);
    }
  }
  store.subscribe((s, prev) => {
    if (s.year !== prev.year && stageEl) {
      stageEl.setAttribute("data-year", fmtYear(s.year));
    }
  });
  window.addEventListener("hashchange", applyRecordMode);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && window.location.hash === "#record") {
      history.replaceState(null, "", window.location.pathname);
      applyRecordMode();
      // Stop playback so user is back to interactive state
      if (store.get("isPlaying")) {
        (document.getElementById("play") as HTMLButtonElement | null)?.click();
      }
    }
  });
  applyRecordMode();
}

bootstrap();
