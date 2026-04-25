import "./styles.css";
import { initMap } from "./viz/map";
import { initTimeline } from "./viz/timeline";
import { initTooltip } from "./viz/tooltip";
import { initSidebar } from "./viz/sidebar";
import { initLineage } from "./viz/lineage";
import { initFilterBar } from "./ui/filterBar";
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
}

bootstrap();
