export function initCinematicCaption(): void {
  const el = document.getElementById("cinematic-caption");
  if (!el) return;
  const noteEl = el.querySelector(".caption-note") as HTMLElement | null;
  if (!noteEl) return;

  let hideTimer: number | null = null;

  function show(note: string): void {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (noteEl!.textContent !== note) {
      // Brief fade-out → swap text → fade-in for smooth transitions
      el!.classList.remove("visible");
      window.setTimeout(() => {
        noteEl!.textContent = note;
        el!.classList.add("visible");
        el!.setAttribute("aria-hidden", "false");
      }, 180);
    } else {
      el!.classList.add("visible");
      el!.setAttribute("aria-hidden", "false");
    }
  }

  function hide(): void {
    el!.classList.remove("visible");
    el!.setAttribute("aria-hidden", "true");
  }

  window.addEventListener("camera:target", (e) => {
    const detail = (e as CustomEvent<{ note?: string }>).detail;
    if (detail?.note) show(detail.note);
  });

  window.addEventListener("camera:user-exit", () => {
    hide();
  });

  // Also hide when autoplay stops (caught via the play button's class change is fragile;
  // simplest: listen for camera:user-exit covers user interaction;
  // for natural play-end, timeline dispatches user-exit indirectly through state changes.
  // We additionally listen for a custom 'cinematic:end' event for clean stops.)
  window.addEventListener("cinematic:end", () => {
    hide();
  });
}
