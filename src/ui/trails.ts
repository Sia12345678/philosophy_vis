import philosophersData from "../data/philosophers.json";
import {
  getTrail,
  getTrailPhilosopher,
  registerTrail,
  trails,
  type Trail,
  type TrailStep,
} from "../data/trails";
import { loadCustomTrail, saveCustomTrail } from "../utils/customTrail";
import type { Philosopher } from "../utils/types";
import { store } from "../utils/store";
import { linkForTrail, parseAppHash, updateAppHash } from "../utils/trailHash";
import { planCustomTrail } from "../utils/trailPlanner";
import {
  clearStoredTrailProgress,
  defaultTrailProgress,
  exportTrailProgress,
  importTrailProgress,
  loadTrailProgress,
  saveTrailProgress,
  visitTrail,
} from "../utils/trailProgress";

const philosophers = philosophersData.philosophers as Philosopher[];
const philosopherById = new Map(philosophers.map((p) => [p.id, p]));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function preferredReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function lifeRange(p: Philosopher, lang: "zh" | "en"): string {
  const year = (value: number): string => {
    if (value < 0) return lang === "en" ? `${Math.abs(value)} BCE` : `前${Math.abs(value)}`;
    return lang === "en" ? `${value} CE` : `${value}`;
  };
  return `${year(p.birth)} – ${year(p.death)}`;
}

function trailNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function theoryFor(
  p: Philosopher,
  step: TrailStep,
  lang: "zh" | "en",
): { primary: string; alternate: string } {
  const zh = p.theories_zh[step.theoryIndex] ?? "";
  const en = p.theories_en[step.theoryIndex] ?? "";
  return lang === "en"
    ? { primary: en || zh, alternate: en ? zh : "" }
    : { primary: zh || en, alternate: zh ? en : "" };
}

function workFor(
  p: Philosopher,
  step: TrailStep,
  lang: "zh" | "en",
): { primary: string; alternate: string; year: number } | null {
  if (step.workIndex === undefined) return null;
  const work = p.works[step.workIndex];
  if (!work) return null;
  return lang === "en"
    ? { primary: work.en || work.zh, alternate: work.en ? work.zh : "", year: work.year }
    : { primary: work.zh || work.en, alternate: work.zh ? work.en : "", year: work.year };
}

export function initTrails(): void {
  const stageCandidate = document.querySelector(".stage") as HTMLElement | null;
  const mapRootCandidate = document.getElementById("map-root");
  const launchCandidate = document.getElementById(
    "trail-launch",
  ) as HTMLButtonElement | null;
  if (!stageCandidate || !mapRootCandidate || !launchCandidate) return;
  const stage = stageCandidate;
  const mapRoot = mapRootCandidate;
  const launch = launchCandidate;

  const storedCustomTrail = loadCustomTrail();
  if (storedCustomTrail) registerTrail(storedCustomTrail);
  let customTrailId = storedCustomTrail?.id ?? null;
  let progress = loadTrailProgress(
    storedCustomTrail ? [...trails, storedCustomTrail] : trails,
  );
  let chooserOpen = false;
  let playerOpen = false;
  let statusMessage = "";
  let cameraTimer: number | null = null;
  let statusTimer: number | null = null;

  const chooser = document.createElement("div");
  chooser.id = "trail-chooser";
  chooser.className = "trail-chooser";
  chooser.hidden = true;
  chooser.setAttribute("role", "dialog");
  chooser.setAttribute("aria-modal", "true");
  chooser.setAttribute("aria-labelledby", "trail-chooser-title");

  const panel = document.createElement("aside");
  panel.id = "trail-panel";
  panel.className = "trail-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "trail-player-title");

  const live = document.createElement("div");
  live.className = "trail-live sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  stage.append(chooser, panel, live);

  function language(): "zh" | "en" {
    return store.get("nameLang");
  }

  function tr(zh: string, en: string): string {
    return language() === "en" ? en : zh;
  }

  function philosopherName(p: Philosopher): string {
    return language() === "en" ? p.name_en : p.name_zh;
  }

  function setStatus(message: string): void {
    statusMessage = message;
    live.textContent = message;
    const target = chooserOpen
      ? chooser.querySelector<HTMLElement>(".trail-status")
      : panel.querySelector<HTMLElement>(".trail-status");
    if (target) target.textContent = message;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusMessage = "";
      const node = (chooserOpen ? chooser : panel).querySelector<HTMLElement>(
        ".trail-status",
      );
      if (node) node.textContent = "";
    }, 5000);
  }

  function syncExpanded(): void {
    launch.setAttribute("aria-expanded", chooserOpen || playerOpen ? "true" : "false");
  }

  function syncBodyClasses(): void {
    document.body.classList.toggle("trail-chooser-open", chooserOpen);
    document.body.classList.toggle("trail-player-open", playerOpen);
    syncExpanded();
  }

  function completedCount(): number {
    const builtInIds = new Set(trails.map((trail) => trail.id));
    return progress.completedTrailIds.filter((id) => builtInIds.has(id)).length;
  }

  function availableTrails(): Trail[] {
    const custom = getTrail(customTrailId);
    return custom ? [...trails, custom] : trails;
  }

  function chooserMarkup(): string {
    const lang = language();
    const suggestions =
      lang === "en"
        ? [
            "Why am I afraid of death?",
            "Does technology make us freer?",
            "How should we face meaninglessness?",
          ]
        : [
            "我为什么会害怕死亡？",
            "技术会让人更自由吗？",
            "人应该如何面对无意义？",
          ];
    const resume = getTrail(progress.currentTrailId);
    const resumeStep = resume
      ? resume.steps[Math.min(progress.currentStep, resume.steps.length) - 1]
      : null;
    const resumePhilosopher = resumeStep ? philosopherById.get(resumeStep.philosopherId) : null;
    const resumeLabel =
      resume && resumePhilosopher
        ? tr(
            `继续《${resume.title_zh}》 · 第 ${progress.currentStep} / ${resume.steps.length} 站 · ${resumePhilosopher.name_zh}`,
            `Continue “${resume.title_en}” · step ${progress.currentStep} / ${resume.steps.length} · ${resumePhilosopher.name_en}`,
          )
        : "";

    return `
      <div class="trail-chooser-backdrop" data-action="dismiss"></div>
      <section class="trail-chooser-panel">
        <button type="button" class="trail-close" data-action="dismiss" aria-label="${escapeHtml(tr("关闭路线入口", "Close trail chooser"))}">×</button>
        <header class="trail-chooser-head">
          <p class="trail-eyebrow">${escapeHtml(tr("从哪里开始", "Where to begin"))}</p>
          <h2 id="trail-chooser-title" tabindex="-1">${escapeHtml(tr("先选一个问题，再进入地图", "Choose a question, then enter the map"))}</h2>
          <p class="trail-lede">${escapeHtml(
            tr(
              "路线不是百科目录。每一站只留下一个问题、一个概念和一条通往下一站的线索。",
              "A trail is not an encyclopedia index. Each stop leaves one question, one concept, and a clue toward the next stop.",
            ),
          )}</p>
        </header>

        <form class="trail-ask" id="trail-ask-form">
          <label for="trail-custom-question">${escapeHtml(
            tr("或者，直接写下你的问题", "Or write your own question"),
          )}</label>
          <div class="trail-ask-row">
            <input
              id="trail-custom-question"
              name="question"
              type="text"
              maxlength="120"
              autocomplete="off"
              placeholder="${escapeHtml(
                tr("例如：我为什么会害怕死亡？", "For example: Why am I afraid of death?"),
              )}"
            />
            <button type="submit">${escapeHtml(tr("规划路线", "Plan trail"))}</button>
          </div>
          <div class="trail-ask-suggestions" aria-label="${escapeHtml(
            tr("问题示例", "Example questions"),
          )}">
            ${suggestions
              .map(
                (question) => `<button type="button" data-action="suggest-question" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`,
              )
              .join("")}
          </div>
        </form>

        ${
          resume
            ? `<button type="button" class="trail-resume" data-action="start-trail" data-trail-id="${escapeHtml(resume.id)}" data-step="${progress.currentStep}">
                <span class="trail-resume-kicker">${escapeHtml(tr("继续上次", "Pick up where you left off"))}</span>
                <span class="trail-resume-text">${escapeHtml(resumeLabel)}</span>
                <span class="trail-resume-arrow" aria-hidden="true">→</span>
              </button>`
            : ""
        }

        <div class="trail-route-grid">
          ${trails
            .map((trail, index) => {
              const done = progress.completedTrailIds.includes(trail.id);
              const title = lang === "en" ? trail.title_en : trail.title_zh;
              const altTitle = lang === "en" ? trail.title_zh : trail.title_en;
              const description = lang === "en" ? trail.description_en : trail.description_zh;
              return `<button type="button" class="trail-route-card" data-action="start-trail" data-trail-id="${escapeHtml(trail.id)}" data-step="1">
                <span class="trail-route-number">${trailNumber(index)}</span>
                <span class="trail-route-copy">
                  <span class="trail-route-title">${escapeHtml(title)}</span>
                  <span class="trail-route-alt" lang="${lang === "en" ? "zh-CN" : "en"}">${escapeHtml(altTitle)}</span>
                  <span class="trail-route-desc">${escapeHtml(description)}</span>
                  <span class="trail-route-meta">${escapeHtml(
                    tr(`${trail.steps.length} 站${done ? " · 已完成" : ""}`, `${trail.steps.length} stops${done ? " · completed" : ""}`),
                  )}</span>
                </span>
                <span class="trail-route-arrow" aria-hidden="true">→</span>
              </button>`;
            })
            .join("")}
        </div>

        <div class="trail-chooser-footer">
          <p class="trail-privacy">${escapeHtml(
            tr(
              `进度只保存在当前浏览器 · 已完成 ${completedCount()} / ${trails.length}`,
              `Progress stays in this browser · ${completedCount()} / ${trails.length} complete`,
            ),
          )}</p>
          <div class="trail-data-actions" aria-label="${escapeHtml(tr("进度数据", "Progress data"))}">
            <button type="button" data-action="export">${escapeHtml(tr("导出", "Export"))}</button>
            <button type="button" data-action="import">${escapeHtml(tr("导入", "Import"))}</button>
            <button type="button" data-action="clear">${escapeHtml(tr("清空", "Clear"))}</button>
          </div>
          <input id="trail-import-file" class="trail-import-file" type="file" accept="application/json,.json" tabindex="-1" />
        </div>
        <p class="trail-status ${statusMessage ? "has-message" : ""}" role="status">${escapeHtml(statusMessage)}</p>
      </section>`;
  }

  function playerMarkup(trail: Trail): string {
    const lang = language();
    const routeIndex = trails.findIndex((candidate) => candidate.id === trail.id);
    const isCustom = routeIndex < 0;
    const stepIndex = Math.min(progress.currentStep, trail.steps.length) - 1;
    const step = trail.steps[stepIndex];
    const philosopher = getTrailPhilosopher(step);
    const theory = theoryFor(philosopher, step, lang);
    const work = workFor(philosopher, step, lang);
    const completed = progress.completedTrailIds.includes(trail.id);
    const isLast = stepIndex === trail.steps.length - 1;
    const progressPercent = ((stepIndex + 1) / trail.steps.length) * 100;
    const question = lang === "en" ? step.question_en : step.question_zh;
    const bridge = lang === "en" ? step.bridge_en : step.bridge_zh;
    const title = lang === "en" ? trail.title_en : trail.title_zh;
    const altTitle = lang === "en" ? trail.title_zh : trail.title_en;
    const shareUrl = isCustom ? "" : linkForTrail(trail.id, stepIndex + 1);
    const kicker = isCustom
      ? tr(
          `你的问题 · 第 ${stepIndex + 1} / ${trail.steps.length} 站`,
          `Your question · step ${stepIndex + 1} / ${trail.steps.length}`,
        )
      : tr(
          `路线 ${trailNumber(routeIndex)} · 第 ${stepIndex + 1} / ${trail.steps.length} 站`,
          `Route ${trailNumber(routeIndex)} · step ${stepIndex + 1} / ${trail.steps.length}`,
        );
    const nextLabel = isLast
      ? completed
        ? tr("已完成 ✓", "Completed ✓")
        : tr("完成路线 ✓", "Finish trail ✓")
      : tr("下一站", "Next");

    return `
      <div class="trail-sheet-grabber" aria-hidden="true"></div>
      <header class="trail-panel-head">
        <div class="trail-panel-topline">
          <span class="trail-kicker">${escapeHtml(
            kicker,
          )}</span>
          <button type="button" class="trail-close" data-action="close" aria-label="${escapeHtml(tr("关闭路线", "Close trail"))}">×</button>
        </div>
        <h2 id="trail-player-title" tabindex="-1">${escapeHtml(title)}${
          completed ? `<span class="trail-done-badge">${escapeHtml(tr("已完成", "Completed"))}</span>` : ""
        }</h2>
        <p class="trail-alt-title" lang="${lang === "en" ? "zh-CN" : "en"}">${escapeHtml(altTitle)}</p>
        <div class="trail-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${trail.steps.length}" aria-valuenow="${stepIndex + 1}" aria-label="${escapeHtml(tr("路线进度", "Trail progress"))}">
          <span style="width:${progressPercent}%"></span>
        </div>
      </header>

      <div class="trail-panel-body">
        <div class="trail-person">
          <span class="trail-step-index">${String(stepIndex + 1).padStart(2, "0")}</span>
          <div>
            <h3>${escapeHtml(philosopherName(philosopher))}</h3>
            <p>${escapeHtml(lifeRange(philosopher, lang))} · ${escapeHtml(philosopher.location[lang])}</p>
          </div>
        </div>

        <blockquote class="trail-question">${escapeHtml(question)}</blockquote>

        <section class="trail-concept" aria-labelledby="trail-concept-label">
          <span id="trail-concept-label" class="trail-section-label">${escapeHtml(tr("核心概念", "Core concept"))}</span>
          <h4>${escapeHtml(theory.primary)}</h4>
          ${theory.alternate ? `<p lang="${lang === "en" ? "zh-CN" : "en"}">${escapeHtml(theory.alternate)}</p>` : ""}
        </section>

        ${
          work
            ? `<section class="trail-work" aria-labelledby="trail-work-label">
                <span id="trail-work-label" class="trail-section-label">${escapeHtml(tr("代表作", "Representative work"))}</span>
                <p><strong>${escapeHtml(work.primary)}</strong>${work.alternate ? `<span lang="${lang === "en" ? "zh-CN" : "en"}"> · ${escapeHtml(work.alternate)}</span>` : ""} <span class="trail-work-year">${escapeHtml(String(work.year))}</span></p>
              </section>`
            : ""
        }

        ${
          isCustom
            ? ""
            : `<section class="trail-bridge" aria-labelledby="trail-bridge-label">
                <span id="trail-bridge-label" class="trail-section-label">${escapeHtml(
                  isLast ? tr("这条路线走到哪里", "Where this trail leads") : tr("为什么下一站是这里", "Why the next stop follows"),
                )}</span>
                <p>${escapeHtml(bridge)}</p>
              </section>`
        }

        <details class="trail-steps">
          <summary>${escapeHtml(tr(`全部 ${trail.steps.length} 站`, `All ${trail.steps.length} stops`))}</summary>
          <ol>
            ${trail.steps
              .map((candidate, index) => {
                const p = philosopherById.get(candidate.philosopherId);
                return `<li>
                  <button type="button" data-action="step" data-step="${index + 1}" ${index === stepIndex ? 'aria-current="step"' : ""}>
                    <span class="trail-list-index">${String(index + 1).padStart(2, "0")}</span>
                    <span>${escapeHtml(p ? philosopherName(p) : candidate.philosopherId)}</span>
                  </button>
                </li>`;
              })
              .join("")}
          </ol>
        </details>
        <p class="trail-status ${statusMessage ? "has-message" : ""}" role="status">${escapeHtml(statusMessage)}</p>
      </div>

      <footer class="trail-panel-foot">
        <div class="trail-nav">
          <button type="button" class="trail-nav-btn" data-action="prev" ${stepIndex === 0 ? "disabled" : ""}>
            <span aria-hidden="true">←</span> ${escapeHtml(tr("上一站", "Previous"))}
          </button>
          <button type="button" class="trail-nav-btn trail-nav-primary" data-action="next" ${isLast && completed ? "disabled" : ""}>
            ${escapeHtml(nextLabel)} <span aria-hidden="true">${isLast ? "" : "→"}</span>
          </button>
        </div>
        <div class="trail-panel-tools">
          <button type="button" data-action="restart">↺ ${escapeHtml(tr("重新开始", "Restart"))}</button>
          ${
            isCustom
              ? `<button type="button" data-action="share-local" title="${escapeHtml(tr("自定义路线只保存在本机", "Custom trails stay on this device"))}">⌂ ${escapeHtml(tr("仅本机", "Local only"))}</button>`
              : `<button type="button" data-action="share" data-share-url="${escapeHtml(shareUrl)}">↗ ${escapeHtml(tr("分享", "Share"))}</button>`
          }
          <button type="button" data-action="routes">☰ ${escapeHtml(tr("路线", "Routes"))}</button>
        </div>
      </footer>`;
  }

  function focusable(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null && !element.hidden);
  }

  function renderChooser(focus = true): void {
    const previousAction =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.getAttribute("data-action")
        : null;
    chooser.innerHTML = chooserMarkup();
    if (!chooserOpen || !focus) return;
    requestAnimationFrame(() => {
      const previous = previousAction
        ? chooser.querySelector<HTMLElement>(`[data-action="${previousAction}"]`)
        : null;
      const heading = chooser.querySelector<HTMLElement>("#trail-chooser-title");
      (previous ?? heading)?.focus();
    });
  }

  function renderPlayer(focus = true): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    const previousAction =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.getAttribute("data-action")
        : null;
    panel.dataset.trailId = trail.id;
    panel.dataset.step = String(progress.currentStep);
    panel.dataset.placement = panelPlacement();
    panel.innerHTML = playerMarkup(trail);
    if (!playerOpen || !focus) return;
    requestAnimationFrame(() => {
      const previous = previousAction
        ? panel.querySelector<HTMLElement>(
            `[data-action="${previousAction}"]:not([disabled])`,
          )
        : null;
      const heading = panel.querySelector<HTMLElement>("#trail-player-title");
      (previous ?? heading)?.focus();
    });
  }

  function announceStep(trail: Trail): void {
    const stepIndex = Math.min(progress.currentStep, trail.steps.length) - 1;
    const step = trail.steps[stepIndex];
    const philosopher = getTrailPhilosopher(step);
    live.textContent = "";
    window.setTimeout(() => {
      live.textContent = tr(
        `第 ${stepIndex + 1} 站，共 ${trail.steps.length} 站。${philosopher.name_zh}。${step.question_zh}`,
        `Stop ${stepIndex + 1} of ${trail.steps.length}. ${philosopher.name_en}. ${step.question_en}`,
      );
    }, 20);
  }

  function panelPlacement(): "left" | "right" | "bottom" {
    if (window.matchMedia("(max-width: 900px) and (max-height: 560px)").matches) {
      return "right";
    }
    if (window.matchMedia("(max-width: 900px)").matches) return "bottom";
    return "left";
  }

  function requestCameraForStep(): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    const step = trail.steps[Math.min(progress.currentStep, trail.steps.length) - 1];
    const philosopher = getTrailPhilosopher(step);
    if (cameraTimer !== null) window.clearTimeout(cameraTimer);
    cameraTimer = window.setTimeout(() => {
      cameraTimer = null;
      const placement = panelPlacement();
      const gap = 24;
      const placementInset =
        placement === "left"
          ? { left: panel.offsetWidth + gap }
          : placement === "right"
            ? { right: panel.offsetWidth + gap }
            : { bottom: panel.offsetHeight + gap };
      const mapRect = mapRoot.getBoundingClientRect();
      const toolsRect = document
        .querySelector<HTMLElement>(".map-tools")
        ?.getBoundingClientRect();
      const top = toolsRect
        ? Math.max(0, toolsRect.bottom - mapRect.top + 12)
        : 0;
      const inset = { ...placementInset, top };
      const mapWidth = mapRect.width;
      const scale = mapWidth < 520 ? 2.35 : mapWidth < 900 ? 2.75 : 3.2;
      window.dispatchEvent(
        new CustomEvent("camera:target", {
          detail: {
            lng: philosopher.location.lng,
            lat: philosopher.location.lat,
            scale,
            durationMs: preferredReducedMotion() ? 0 : 760,
            inset,
          },
        }),
      );
    }, preferredReducedMotion() ? 0 : 40);
  }

  function focusMapOnStep(): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    const step = trail.steps[Math.min(progress.currentStep, trail.steps.length) - 1];
    const philosopher = getTrailPhilosopher(step);
    store.set({
      year: Math.round((philosopher.birth + philosopher.death) / 2),
      selectedId: null,
      spotlightId: philosopher.id,
      searchQuery: "",
      schoolFilter: null,
      isPlaying: false,
    });
    window.dispatchEvent(new CustomEvent("cinematic:end"));
    requestCameraForStep();
  }

  function revealPlayer(): void {
    playerOpen = true;
    panel.hidden = false;
    chooserOpen = false;
    chooser.hidden = true;
    panel.dataset.placement = panelPlacement();
    syncBodyClasses();
  }

  function hidePlayer(options: { syncHash?: boolean; focusLaunch?: boolean } = {}): void {
    playerOpen = false;
    panel.hidden = true;
    if (options.syncHash !== false) updateAppHash({ trailId: null, step: null });
    // Sync body classes before clearing the spotlight. At <=360px the map
    // tools are hidden while the player is open; clearing the spotlight first
    // would place labels without accounting for the tools that reappear.
    syncBodyClasses();
    if (!chooserOpen) store.set({ spotlightId: null });
    if (options.focusLaunch) launch.focus();
  }

  function goToStep(
    trailId: string,
    step: number,
    options: { syncHash?: boolean; focus?: boolean; announce?: boolean } = {},
  ): void {
    const trail = getTrail(trailId);
    if (!trail) return;
    progress = visitTrail(progress, trail, step);
    progress = { ...progress, introDismissed: true, updatedAt: Date.now() };
    saveTrailProgress(progress);
    revealPlayer();
    if (options.syncHash !== false) {
      updateAppHash({ trailId: trail.id, step: progress.currentStep });
    }
    renderPlayer(options.focus !== false);
    const body = panel.querySelector<HTMLElement>(".trail-panel-body");
    if (body) body.scrollTop = 0;
    focusMapOnStep();
    if (options.announce !== false) announceStep(trail);
  }

  function openChooser(focus = true): void {
    chooserOpen = true;
    chooser.hidden = false;
    syncBodyClasses();
    renderChooser(focus);
  }

  function dismissChooser(markDismissed = true): void {
    if (markDismissed) {
      progress = { ...progress, introDismissed: true, updatedAt: Date.now() };
      saveTrailProgress(progress);
    }
    chooserOpen = false;
    chooser.hidden = true;
    syncBodyClasses();
    if (playerOpen) {
      (panel.querySelector<HTMLElement>('[data-action="routes"]') ??
        panel.querySelector<HTMLElement>("#trail-player-title"))?.focus();
    } else {
      launch.focus();
    }
  }

  function startTrail(trailId: string, step: number): void {
    dismissChooser(true);
    goToStep(trailId, step, { focus: true });
  }

  function planFromQuestion(rawQuestion: string): void {
    const question = rawQuestion.replace(/\s+/g, " ").trim();
    if (Array.from(question).length < 2) {
      setStatus(
        tr(
          "先写下一个你想追问的问题，至少两个字。",
          "Write a question you want to pursue (at least two characters).",
        ),
      );
      chooser
        .querySelector<HTMLInputElement>("#trail-custom-question")
        ?.focus();
      return;
    }
    try {
      const trail = planCustomTrail(question);
      saveCustomTrail(trail);
      registerTrail(trail);
      customTrailId = trail.id;
      startTrail(trail.id, 1);
    } catch (error) {
      console.error("[trails] failed to plan custom trail", error);
      setStatus(
        tr(
          "这条问题暂时无法规划，请换一种问法。",
          "That question could not be planned. Try rephrasing it.",
        ),
      );
    }
  }

  function completeCurrentTrail(): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    if (!progress.completedTrailIds.includes(trail.id)) {
      progress = {
        ...progress,
        completedTrailIds: [...progress.completedTrailIds, trail.id],
        updatedAt: Date.now(),
      };
      saveTrailProgress(progress);
    }
    setStatus(tr("这条路线已完成。", "This trail is complete."));
    renderPlayer(true);
    announceStep(trail);
  }

  function previousStep(): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail || progress.currentStep <= 1) return;
    goToStep(trail.id, progress.currentStep - 1);
  }

  function nextStep(): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    if (progress.currentStep >= trail.steps.length) {
      completeCurrentTrail();
      return;
    }
    goToStep(trail.id, progress.currentStep + 1);
  }

  function restartTrail(): void {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    goToStep(trail.id, 1);
  }

  function exportProgress(): void {
    const content = exportTrailProgress(progress);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `philosophy-trails-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(tr("进度已导出。", "Progress exported."));
  }

  async function importProgress(file: File): Promise<void> {
    try {
      const text = await file.text();
      const imported = importTrailProgress(text, availableTrails());
      progress = imported;
      saveTrailProgress(progress);
      const trail = getTrail(progress.currentTrailId);
      if (trail) {
        dismissChooser(false);
        goToStep(trail.id, progress.currentStep, { focus: true });
      } else {
        openChooser(true);
      }
      setStatus(tr("进度已导入。", "Progress imported."));
    } catch {
      setStatus(tr("导入失败：文件格式或版本不受支持。", "Import failed: unsupported file format or version."));
    }
  }

  function clearProgress(): void {
    const question = tr(
      "清空路线进度？已完成记录、当前步骤和入口状态都会重置。",
      "Clear trail progress? Completed trails, current step, and chooser state will be reset.",
    );
    if (!window.confirm(question)) return;
    progress = defaultTrailProgress();
    clearStoredTrailProgress();
    hidePlayer({ syncHash: false });
    updateAppHash({ trailId: null, step: null });
    store.set({ spotlightId: null });
    chooserOpen = false;
    setStatus(tr("进度已清空。", "Progress cleared."));
    openChooser(true);
  }

  async function shareCurrentStep(): Promise<void> {
    const trail = getTrail(progress.currentTrailId);
    if (!trail) return;
    if (!trails.some((candidate) => candidate.id === trail.id)) {
      setStatus(
        tr(
          "自定义路线只保存在当前浏览器，暂时不能生成分享链接。",
          "Custom trails are local-only and cannot be shared by link yet.",
        ),
      );
      return;
    }
    const url = linkForTrail(trail.id, progress.currentStep);
    try {
      await navigator.clipboard.writeText(url);
      setStatus(tr("分享链接已复制。", "Share link copied."));
    } catch {
      window.prompt(tr("复制这条路线链接：", "Copy this trail link:"), url);
    }
  }

  function trapChooserFocus(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissChooser(true);
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable(chooser);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handlePanelKeys(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hidePlayer({ focusLaunch: true });
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea, summary")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousStep();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nextStep();
    }
  }

  chooser.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === "dismiss") dismissChooser(true);
    else if (action === "start-trail") {
      const trailId = actionEl.dataset.trailId;
      const step = Number.parseInt(actionEl.dataset.step ?? "1", 10) || 1;
      if (trailId) startTrail(trailId, step);
    } else if (action === "export") exportProgress();
    else if (action === "import") {
      chooser.querySelector<HTMLInputElement>("#trail-import-file")?.click();
    } else if (action === "clear") clearProgress();
    else if (action === "suggest-question") {
      const question = actionEl.dataset.question ?? "";
      const input = chooser.querySelector<HTMLInputElement>(
        "#trail-custom-question",
      );
      if (input) input.value = question;
      planFromQuestion(question);
    }
  });

  chooser.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (form.id !== "trail-ask-form") return;
    event.preventDefault();
    planFromQuestion(
      chooser.querySelector<HTMLInputElement>("#trail-custom-question")
        ?.value ?? "",
    );
  });

  chooser.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== "trail-import-file") return;
    const file = input.files?.[0];
    input.value = "";
    if (file) void importProgress(file);
  });

  chooser.addEventListener("keydown", trapChooserFocus);

  panel.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === "close") hidePlayer({ focusLaunch: true });
    else if (action === "prev") previousStep();
    else if (action === "next") nextStep();
    else if (action === "restart") restartTrail();
    else if (action === "share") void shareCurrentStep();
    else if (action === "share-local")
      setStatus(
        tr(
          "自定义路线只保存在当前浏览器。",
          "Custom trails are saved in this browser only.",
        ),
      );
    else if (action === "routes") openChooser(true);
    else if (action === "step") {
      const step = Number.parseInt(actionEl.dataset.step ?? "", 10);
      const trail = getTrail(progress.currentTrailId);
      if (trail && Number.isFinite(step) && step >= 1) goToStep(trail.id, step);
    }
  });

  panel.addEventListener("keydown", handlePanelKeys);

  launch.addEventListener("click", () => openChooser(true));

  store.subscribe((state, previous) => {
    if (state.nameLang === previous.nameLang) return;
    if (chooserOpen) renderChooser(false);
    if (playerOpen) renderPlayer(false);
  });

  window.addEventListener("hashchange", () => {
    const hash = parseAppHash();
    if (hash.trailId) {
      const trail = getTrail(hash.trailId);
      if (!trail) {
        setStatus(tr("无法打开这条路线链接，已回到路线选择。", "That trail link is invalid. Returning to route choices."));
        updateAppHash({ trailId: null, step: null });
        openChooser(true);
        return;
      }
      const next = Math.min(hash.step ?? 1, trail.steps.length);
      if (progress.currentTrailId !== trail.id || progress.currentStep !== next) {
        goToStep(trail.id, next, { syncHash: false, focus: true });
      }
      return;
    }
    if (playerOpen) hidePlayer({ syncHash: false });
  });

  window.addEventListener("resize", () => {
    if (!playerOpen) return;
    panel.dataset.placement = panelPlacement();
  });

  syncExpanded();

  const initialHash = parseAppHash();
  const linkedTrail = getTrail(initialHash.trailId);
  if (initialHash.trailId) {
    if (linkedTrail) {
      goToStep(linkedTrail.id, initialHash.step ?? 1, { focus: true });
    } else {
      updateAppHash({ trailId: null, step: null });
      setStatus(tr("无法打开这条路线链接，已回到路线选择。", "That trail link is invalid. Returning to route choices."));
      if (!initialHash.record) openChooser(true);
    }
  } else if (!initialHash.record) {
    const savedTrail = getTrail(progress.currentTrailId);
    const savedIsComplete =
      savedTrail !== null && progress.completedTrailIds.includes(savedTrail.id);
    if (savedTrail && !savedIsComplete) {
      goToStep(savedTrail.id, progress.currentStep, {
        focus: false,
        announce: false,
      });
    } else if (!progress.introDismissed) {
      openChooser(true);
    }
  }
}
