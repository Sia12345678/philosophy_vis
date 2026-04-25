function shortYear(year: number): string {
  if (year < 0) return `c. ${Math.abs(year)} BCE`;
  if (year === 0) return "1 CE";
  return `c. ${year} CE`;
}

export function initCinematicCaption(): void {
  const el = document.getElementById("cinematic-caption");
  if (!el) return;
  const eyebrowEl = el.querySelector(".caption-eyebrow") as HTMLElement | null;
  const noteEl = el.querySelector(".caption-note") as HTMLElement | null;
  if (!eyebrowEl || !noteEl) return;

  let hideTimer: number | null = null;
  let pendingShow: number | null = null;
  let lastNote = "";

  function show(note: string, year: number | undefined): void {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (pendingShow !== null) {
      window.clearTimeout(pendingShow);
      pendingShow = null;
    }

    const yearText = year != null ? shortYear(year) : "";

    // If first show or note unchanged → just show
    if (!el!.classList.contains("visible") || note === lastNote) {
      eyebrowEl!.textContent = yearText;
      noteEl!.textContent = note;
      lastNote = note;
      // Force reflow so the entry animation re-runs from the start
      el!.classList.remove("visible");
      void el!.offsetWidth;
      el!.classList.add("visible");
      el!.setAttribute("aria-hidden", "false");
      return;
    }

    // Swap: animate out, replace text, animate in
    el!.classList.remove("visible");
    pendingShow = window.setTimeout(() => {
      eyebrowEl!.textContent = yearText;
      noteEl!.textContent = note;
      lastNote = note;
      el!.classList.add("visible");
      el!.setAttribute("aria-hidden", "false");
      pendingShow = null;
    }, 320);
  }

  function hide(): void {
    if (pendingShow !== null) {
      window.clearTimeout(pendingShow);
      pendingShow = null;
    }
    el!.classList.remove("visible");
    el!.setAttribute("aria-hidden", "true");
    lastNote = "";
  }

  window.addEventListener("camera:target", (e) => {
    const detail = (e as CustomEvent<{ note?: string; targetYear?: number }>)
      .detail;
    if (detail?.note) show(detail.note, detail.targetYear);
  });

  window.addEventListener("camera:user-exit", hide);
  window.addEventListener("cinematic:end", hide);
}
