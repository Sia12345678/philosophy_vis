import philosophersData from "../data/philosophers.json";
import schoolsData from "../data/schools.json";
import type { Philosopher, School } from "../utils/types";
import { store } from "../utils/store";
import { formatLifespan } from "../utils/i18n";
import { mountChatPanel } from "../chat/chatPanel";

const philosophers = philosophersData.philosophers as Philosopher[];
const phById = new Map(philosophers.map((p) => [p.id, p]));
const schoolById = new Map(
  (schoolsData.schools as School[]).map((s) => [s.id, s]),
);

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
      ? "&lt;"
      : c === ">"
      ? "&gt;"
      : c === '"'
      ? "&quot;"
      : "&#39;",
  );
}

function renderLinkList(ids: string[]): string {
  if (!ids.length) return '<span style="color:var(--ink-faint)">—</span>';
  return ids
    .map((id) => {
      const p = phById.get(id);
      const label = p ? p.name_zh : id;
      return `<a href="#" data-jump="${id}" style="color:var(--accent);text-decoration:none;border-bottom:1px dotted">${label}</a>`;
    })
    .join("、");
}

function render(p: Philosopher): string {
  const schoolNames = p.schools
    .map((s) => schoolById.get(s)?.name_zh ?? s)
    .join(" · ");
  return `
    <button class="close-btn" aria-label="关闭">×</button>
    <h2 class="sb-name">${p.name_zh}<span class="sb-name-en">${p.name_en}</span></h2>
    <div class="sb-meta">${formatLifespan(p.birth, p.death)} · ${schoolNames} · ${p.location.zh}</div>

    <h3>简介</h3>
    <p>${p.bio_zh}</p>

    <h3>核心理论</h3>
    <ul>${p.theories_zh.map((t, i) => `<li>${t}<span class="work-year">${p.theories_en[i] ?? ""}</span></li>`).join("")}</ul>

    ${
      p.works.length
        ? `<h3>代表作</h3>
    <ul>${p.works.map((w) => `<li>${w.zh} <span class="work-year">${w.en}, ${w.year}</span>${
            w.download
              ? ` <a class="work-download" href="${escapeAttr(w.download.url)}" target="_blank" rel="noreferrer">📖 ${escapeAttr(w.download.source)}</a>`
              : ""
          }</li>`).join("")}</ul>`
        : ""
    }

    <h3>师承 / 受影响于</h3>
    <p>${renderLinkList(p.influenced_by)}</p>

    <h3>影响</h3>
    <p>${renderLinkList(p.influenced)}</p>

    <div class="chat-panel" data-philosopher-id="${p.id}"></div>
  `;
}

export function initSidebar(): void {
  const sb = document.getElementById("sidebar");
  if (!sb) return;

  let unmountChat: (() => void) | null = null;

  function show(id: string | null): void {
    // Always tear down any previous chat first to abort streams + clear history
    if (unmountChat) {
      unmountChat();
      unmountChat = null;
    }
    if (!id) {
      sb!.classList.add("collapsed");
      sb!.setAttribute("aria-hidden", "true");
      return;
    }
    const p = phById.get(id);
    if (!p) return;
    sb!.innerHTML = render(p);
    sb!.classList.remove("collapsed");
    sb!.setAttribute("aria-hidden", "false");
    const chatRoot = sb!.querySelector(".chat-panel") as HTMLElement | null;
    if (chatRoot) {
      unmountChat = mountChatPanel(p, chatRoot);
    }
  }

  sb.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("close-btn")) {
      store.set({ selectedId: null });
      return;
    }
    const jump = target.getAttribute("data-jump");
    if (jump) {
      e.preventDefault();
      store.set({ selectedId: jump });
    }
  });

  store.subscribe((s, prev) => {
    if (s.selectedId !== prev.selectedId) {
      show(s.selectedId);
    }
  });
}
