import "./styles.css";
import { initMap } from "./viz/map";
import { initTimeline } from "./viz/timeline";
import { initTooltip } from "./viz/tooltip";
import { initSidebar } from "./viz/sidebar";
import { initLineage } from "./viz/lineage";
import { initFilterBar } from "./ui/filterBar";
import { initCinematicCaption } from "./ui/cinematicCaption";
import { store } from "./utils/store";
import philosophersData from "./data/philosophers.json";
import type { Philosopher } from "./utils/types";

const philosophers = philosophersData.philosophers as Philosopher[];

function findBestMatch(q: string): Philosopher | null {
  // Priority: id exact > zh exact > en exact > zh contains > en contains > id contains
  let exactZh: Philosopher | null = null;
  let exactEn: Philosopher | null = null;
  let containsZh: Philosopher | null = null;
  let containsEn: Philosopher | null = null;
  let containsId: Philosopher | null = null;
  for (const p of philosophers) {
    if (p.id === q) return p;
    const zh = p.name_zh.toLowerCase();
    const en = p.name_en.toLowerCase();
    if (!exactZh && zh === q) exactZh = p;
    if (!exactEn && en === q) exactEn = p;
    if (!containsZh && zh.includes(q)) containsZh = p;
    if (!containsEn && en.includes(q)) containsEn = p;
    if (!containsId && p.id.includes(q)) containsId = p;
  }
  return exactZh ?? exactEn ?? containsZh ?? containsEn ?? containsId;
}

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
    // Enter → locate top-matching philosopher: select + jump year + zoom camera
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const q = search.value.trim().toLowerCase();
      if (!q) return;
      const match = findBestMatch(q);
      if (!match) return;
      // Pause playback if running so the locate sticks
      if (store.get("isPlaying")) {
        (document.getElementById("play") as HTMLButtonElement | null)?.click();
      }
      const midYear = Math.round((match.birth + match.death) / 2);
      // Clear the search filter so the located dot shows in context
      search.value = "";
      store.set({
        searchQuery: "",
        selectedId: match.id,
        year: midYear,
      });
      window.dispatchEvent(
        new CustomEvent("camera:target", {
          detail: {
            lng: match.location.lng,
            lat: match.location.lat,
            scale: 3.5,
            durationMs: 900,
          },
        }),
      );
      search.blur();
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

  const showAllToggle = document.getElementById(
    "toggle-show-all",
  ) as HTMLInputElement | null;
  if (showAllToggle) {
    showAllToggle.addEventListener("change", () => {
      store.set({ showAllPhilosophers: showAllToggle.checked });
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
