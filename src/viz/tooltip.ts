import philosophersData from "../data/philosophers.json";
import schoolsData from "../data/schools.json";
import type { Philosopher, School } from "../utils/types";
import { formatLifespan } from "../utils/i18n";
import { store } from "../utils/store";

const philosophers = philosophersData.philosophers as Philosopher[];
const phById = new Map(philosophers.map((p) => [p.id, p]));
const schoolById = new Map(
  (schoolsData.schools as School[]).map((s) => [s.id, s]),
);

export function initTooltip(): void {
  const tip = document.getElementById("tooltip");
  if (!tip) return;

  function render(p: Philosopher): string {
    const schoolNames = p.schools
      .map((s) => schoolById.get(s)?.name_zh ?? s)
      .join(" · ");
    const theories = p.theories_zh
      .slice(0, 3)
      .map((t) => `<li>${t}</li>`)
      .join("");
    const works = p.works
      .slice(0, 2)
      .map((w) => `<li>${w.zh} <span class="work-year">${w.year}</span></li>`)
      .join("");
    const lang = store.get("nameLang");
    const primary = lang === "en" ? p.name_en : p.name_zh;
    const secondary = lang === "en" ? p.name_zh : p.name_en;
    return `
      <div class="tt-name">${primary}<span class="tt-name-en">${secondary}</span></div>
      <div class="tt-meta">${formatLifespan(p.birth, p.death)} · ${schoolNames}</div>
      ${
        theories
          ? `<div class="tt-section"><div class="tt-section-label">核心理论</div><ul>${theories}</ul></div>`
          : ""
      }
      ${
        works
          ? `<div class="tt-section"><div class="tt-section-label">代表作</div><ul>${works}</ul></div>`
          : ""
      }
    `;
  }

  function position(x: number, y: number): void {
    const margin = 14;
    const tw = tip!.offsetWidth;
    const th = tip!.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + margin;
    let top = y + margin;
    if (left + tw > vw - 8) left = x - tw - margin;
    if (top + th > vh - 8) top = y - th - margin;
    tip!.style.left = `${left}px`;
    tip!.style.top = `${top}px`;
  }

  window.addEventListener("philosopher:hover", (e) => {
    const detail = (e as CustomEvent<{ id: string; x: number; y: number }>)
      .detail;
    const p = phById.get(detail.id);
    if (!p) return;
    tip.innerHTML = render(p);
    tip.classList.add("visible");
    position(detail.x, detail.y);
  });

  window.addEventListener("philosopher:unhover", () => {
    tip.classList.remove("visible");
  });
}
