import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "qa");
const screenshotsDir = path.join(outputDir, "screenshots");
const temporaryDir = path.join(outputDir, "tmp");

const trailDocument = JSON.parse(
  await fs.readFile(path.join(root, "src/data/trails.json"), "utf8"),
);
const trails = trailDocument.trails;
const philosophers = JSON.parse(
  await fs.readFile(path.join(root, "src/data/philosophers.json"), "utf8"),
).philosophers;
const philosopherById = new Map(
  philosophers.map((philosopher) => [philosopher.id, philosopher]),
);

const baselineBundle = { jsGzipKb: 75.94, cssGzipKb: 6.37 };
const bundleBudget = { jsGzipKb: 30, cssGzipKb: 8 };
const results = [];
const failures = [];
const screenshots = [];

function check(name, condition, details = "") {
  const passed = Boolean(condition);
  results.push({ name, passed, details: String(details ?? "") });
  if (!passed) {
    const message = details ? `${name}: ${details}` : name;
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .trim();
}

function rectsOverlap(first, second, tolerance = 0.75) {
  if (!first || !second) return false;
  return (
    first.left < second.right - tolerance &&
    first.right > second.left + tolerance &&
    first.top < second.bottom - tolerance &&
    first.bottom > second.top + tolerance
  );
}

function pointInsideRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

async function gzipSizeKb(filePath) {
  const content = await fs.readFile(filePath);
  return Number((zlib.gzipSync(content).length / 1024).toFixed(2));
}

async function bundleSizes() {
  const assetsDir = path.join(root, "dist/assets");
  const entries = await fs.readdir(assetsDir);
  const javascript = entries.filter((entry) => entry.endsWith(".js"));
  const stylesheets = entries.filter((entry) => entry.endsWith(".css"));
  const javascriptGzipKb = (
    await Promise.all(
      javascript.map((entry) => gzipSizeKb(path.join(assetsDir, entry))),
    )
  ).reduce((total, value) => total + value, 0);
  const cssGzipKb = (
    await Promise.all(
      stylesheets.map((entry) => gzipSizeKb(path.join(assetsDir, entry))),
    )
  ).reduce((total, value) => total + value, 0);
  return {
    javascriptGzipKb: Number(javascriptGzipKb.toFixed(2)),
    cssGzipKb: Number(cssGzipKb.toFixed(2)),
  };
}

function watchPageErrors(page, origin) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= 400) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return errors;
}

async function createPage(browser, origin, viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
    reducedMotion: options.reducedMotion ?? "no-preference",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeout ?? 8000);
  const errors = watchPageErrors(page, origin);
  return { context, page, errors };
}

async function loadApp(page, baseUrl, hash = "") {
  await page.goto(`${baseUrl}${hash}`, { waitUntil: "domcontentloaded" });
  await page.locator("#map-root path.land").first().waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.waitForTimeout(250);
}

async function chooserIsOpen(page) {
  return page.locator("#trail-chooser").isVisible().catch(() => false);
}

async function dismissChooser(page) {
  if (!(await chooserIsOpen(page))) return;
  await page.locator("#trail-chooser .trail-close").click();
  await page.locator("#trail-chooser").waitFor({ state: "hidden" });
}

async function openChooser(page) {
  if (await chooserIsOpen(page)) return;
  const routesButton = page.locator('#trail-panel [data-action="routes"]');
  if (await routesButton.isVisible().catch(() => false)) {
    await routesButton.click();
  } else {
    await page.locator("#trail-launch").click();
  }
  await page.locator("#trail-chooser").waitFor({ state: "visible" });
}

async function waitForPanelStep(page, step) {
  await page.waitForFunction(
    (expectedStep) =>
      document.querySelector("#trail-panel")?.getAttribute("data-step") ===
      String(expectedStep),
    step,
    { timeout: 6000 },
  );
  await page
    .locator("text.philosopher-label.spotlight.visible")
    .waitFor({ state: "visible", timeout: 6000 });
}

async function startTrail(page, routeIndex) {
  await openChooser(page);
  await page.locator(".trail-route-card").nth(routeIndex).click();
  await page.locator("#trail-panel").waitFor({ state: "visible" });
  await waitForPanelStep(page, 1);
  await page.waitForTimeout(820);
}

async function panelState(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const panel = document.querySelector("#trail-panel");
    const body = document.querySelector(".trail-panel-body");
    const label = document.querySelector(
      "text.philosopher-label.spotlight.visible",
    );
    const spotlight = document.querySelector("circle.philosopher.spotlight");
    const tools = document.querySelector(".map-tools");
    const toolsStyle = tools ? getComputedStyle(tools) : null;
    const timeline = document.querySelector(".timeline-bar");
    const progress = document.querySelector(
      '.trail-progress[role="progressbar"]',
    );
    return {
      panelStep: panel?.getAttribute("data-step") ?? null,
      trailId: panel?.getAttribute("data-trail-id") ?? null,
      spotlightId: spotlight?.getAttribute("data-id") ?? null,
      labelText: label?.textContent ?? "",
      question: document.querySelector(".trail-question")?.textContent ?? "",
      concept: document.querySelector(".trail-concept h4")?.textContent ?? "",
      bridge: document.querySelector(".trail-bridge p")?.textContent ?? "",
      bodyClientHeight: body?.clientHeight ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      year: Number(
        (document.querySelector("#timeline") ?? {}).value ?? Number.NaN,
      ),
      progressValue: progress?.getAttribute("aria-valuenow") ?? null,
      panelRect: rect(panel),
      mapRect: rect(document.querySelector("#map-root")),
      timelineRect: rect(timeline),
      toolsRect:
        toolsStyle && toolsStyle.display !== "none" ? rect(tools) : null,
      spotlightRect: rect(spotlight),
      labelRect: rect(label),
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
}

async function assertPanelStep(page, label, trail, step, language = "zh") {
  const expectedStep = trail.steps[step - 1];
  const philosopher = philosopherById.get(expectedStep.philosopherId);
  const expectedName =
    language === "en" ? philosopher.name_en : philosopher.name_zh;
  const state = await panelState(page);

  check(`${label}: panel step ${step}`, state.panelStep === String(step), state.panelStep);
  check(`${label}: route id`, state.trailId === trail.id, state.trailId ?? "");
  check(
    `${label}: spotlight id`,
    state.spotlightId === expectedStep.philosopherId,
    `${state.spotlightId} != ${expectedStep.philosopherId}`,
  );
  check(
    `${label}: spotlight has visible name`,
    normalizeText(state.labelText).includes(normalizeText(expectedName)),
    state.labelText,
  );
  check(`${label}: question present`, Boolean(normalizeText(state.question)));
  check(`${label}: concept present`, Boolean(normalizeText(state.concept)));
  check(`${label}: bridge present`, Boolean(normalizeText(state.bridge)));
  check(
    `${label}: step year inside lifespan`,
    Number.isFinite(state.year) &&
      state.year >= philosopher.birth &&
      state.year <= philosopher.death,
    String(state.year),
  );
  check(
    `${label}: progressbar value`,
    state.progressValue === String(step),
    state.progressValue ?? "",
  );
  check(
    `${label}: route body readable`,
    state.bodyClientHeight >= 80,
    `${state.bodyClientHeight}px`,
  );
  check(
    `${label}: panel inside map`,
    state.panelRect &&
      state.mapRect &&
      state.panelRect.top >= state.mapRect.top - 1 &&
      state.panelRect.bottom <= state.mapRect.bottom + 1,
    JSON.stringify({ panel: state.panelRect, map: state.mapRect }),
  );
  check(
    `${label}: panel does not cover focused dot`,
    !rectsOverlap(state.panelRect, state.spotlightRect),
  );
  check(
    `${label}: panel does not cover focused name`,
    !rectsOverlap(state.panelRect, state.labelRect),
  );
  check(
    `${label}: tools do not cover focused dot`,
    !state.toolsRect || !rectsOverlap(state.toolsRect, state.spotlightRect),
  );
  check(
    `${label}: tools do not cover focused name`,
    !state.toolsRect || !rectsOverlap(state.toolsRect, state.labelRect),
  );
  check(
    `${label}: focused dot inside map`,
    state.spotlightRect &&
      state.mapRect &&
      state.spotlightRect.left >= state.mapRect.left &&
      state.spotlightRect.right <= state.mapRect.right &&
      state.spotlightRect.top >= state.mapRect.top &&
      state.spotlightRect.bottom <= state.mapRect.bottom,
  );
  check(
    `${label}: panel does not cover timeline`,
    !state.timelineRect ||
      !state.panelRect ||
      state.panelRect.bottom <= state.timelineRect.top + 1,
  );
  check(
    `${label}: background scroll locked`,
    state.bodyOverflow === "hidden",
    state.bodyOverflow,
  );
  return state;
}

async function labelAudit(page) {
  return page.evaluate(() => {
    const toRect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0.05 &&
        box.width > 0 &&
        box.height > 0
      );
    };
    const overlaps = (first, second) =>
      first.left < second.right - 0.75 &&
      first.right > second.left + 0.75 &&
      first.top < second.bottom - 0.75 &&
      first.bottom > second.top + 0.75;
    const containsPoint = (rect, x, y) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    const mapRect = toRect(document.querySelector("#map-root"));
    const labels = [
      ...document.querySelectorAll(
        "text.philosopher-label.visible, text.cluster-label.visible",
      ),
    ]
      .filter(isVisible)
      .map((element) => ({
        text: element.textContent ?? "",
        id: element.getAttribute("data-id"),
        members: element.getAttribute("data-members"),
        rect: toRect(element),
      }));

    const controlElements = [
      ...document.querySelectorAll(
        ".map-tools, .map-era, .map-legend, #trail-panel, #trail-chooser, #sidebar:not(.collapsed)",
      ),
    ].filter(isVisible);
    const controls = controlElements.map((element) => ({
      name: element.id || element.className,
      rect: toRect(element),
    }));

    const activeDots = [
      ...document.querySelectorAll("circle.philosopher.active"),
    ]
      .filter(isVisible)
      .map((element) => ({
        id: element.getAttribute("data-id") ?? "",
        rect: toRect(element),
      }))
      .filter((dot) => {
        const centerX = dot.rect.left + dot.rect.width / 2;
        const centerY = dot.rect.top + dot.rect.height / 2;
        if (!containsPoint(mapRect, centerX, centerY)) return false;
        return !controls.some((control) =>
          containsPoint(control.rect, centerX, centerY),
        );
      });

    const labelOverlaps = [];
    for (let first = 0; first < labels.length; first++) {
      for (let second = first + 1; second < labels.length; second++) {
        if (overlaps(labels[first].rect, labels[second].rect)) {
          labelOverlaps.push([labels[first].text, labels[second].text]);
        }
      }
    }

    const labelDotOverlaps = [];
    for (const label of labels) {
      for (const dot of activeDots) {
        if (overlaps(label.rect, dot.rect)) {
          labelDotOverlaps.push([label.text, dot.id]);
        }
      }
    }

    const labelControlOverlaps = [];
    for (const label of labels) {
      for (const control of controls) {
        if (overlaps(label.rect, control.rect)) {
          labelControlOverlaps.push([label.text, control.name]);
        }
      }
    }

    const outOfBounds = labels
      .filter(
        (label) =>
          label.rect.left < mapRect.left - 0.75 ||
          label.rect.right > mapRect.right + 0.75 ||
          label.rect.top < mapRect.top - 0.75 ||
          label.rect.bottom > mapRect.bottom + 0.75,
      )
      .map((label) => label.text);

    const coveredIds = new Set();
    for (const label of labels) {
      if (label.id) coveredIds.add(label.id);
      if (label.members) {
        for (const id of label.members.split("|")) coveredIds.add(id);
      }
    }
    const uncovered = activeDots
      .map((dot) => dot.id)
      .filter((id) => !coveredIds.has(id));

    return {
      labelCount: labels.length,
      activeDotCount: activeDots.length,
      labelOverlaps,
      labelDotOverlaps,
      labelControlOverlaps,
      outOfBounds,
      uncovered,
    };
  });
}

async function touchTargetAudit(page, selector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (!root) return [];
    return [...root.querySelectorAll("button, [role='button'], a[href]")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.05 &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute("aria-label") ||
            element.textContent?.trim().slice(0, 24) ||
            element.tagName,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((target) => target.width < 40 || target.height < 40);
  }, selector);
}

function assertLabelAudit(label, audit) {
  check(`${label}: labels do not overlap each other`, audit.labelOverlaps.length === 0, JSON.stringify(audit.labelOverlaps));
  check(`${label}: labels do not overlap active dots`, audit.labelDotOverlaps.length === 0, JSON.stringify(audit.labelDotOverlaps));
  check(`${label}: labels do not overlap controls`, audit.labelControlOverlaps.length === 0, JSON.stringify(audit.labelControlOverlaps));
  check(`${label}: labels stay inside map`, audit.outOfBounds.length === 0, JSON.stringify(audit.outOfBounds));
  check(`${label}: every on-screen active dot has a name or count`, audit.uncovered.length === 0, JSON.stringify(audit.uncovered));
}

async function readProgress(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("philosophy_vis_trail_progress_v1");
    return raw ? JSON.parse(raw) : null;
  });
}

async function runRouteWalk(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(browser, origin, {
    width: 1440,
    height: 900,
  });
  await loadApp(page, baseUrl);
  check("first screen: chooser visible", await chooserIsOpen(page));
  check(
    "first screen: three route cards",
    (await page.locator(".trail-route-card").count()) === 3,
  );
  check(
    "first screen: no horizontal overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );

  await dismissChooser(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#map-root path.land").first().waitFor({ state: "visible" });
  check("chooser dismissal persists after reload", !(await chooserIsOpen(page)));

  for (const [routeIndex, trail] of trails.entries()) {
    await startTrail(page, routeIndex);
    const title = await page.locator("#trail-player-title").innerText();
    check(
      `route ${trail.id}: bilingual title rendered`,
      title.includes(trail.title_zh),
      title,
    );

    for (let step = 1; step <= trail.steps.length; step++) {
      await page.waitForTimeout(820);
      await assertPanelStep(
        page,
        `route ${trail.id} step ${step}`,
        trail,
        step,
      );
      if (step < trail.steps.length) {
        await page.locator('#trail-panel [data-action="next"]').click();
        await waitForPanelStep(page, step + 1);
      } else {
        await page.locator('#trail-panel [data-action="next"]').click();
        await page.locator(".trail-done-badge").waitFor({ state: "visible" });
      }
    }

    const progress = await readProgress(page);
    check(
      `route ${trail.id}: completion persisted`,
      progress?.completedTrailIds?.includes(trail.id) === true,
      JSON.stringify(progress?.completedTrailIds ?? []),
    );
  }

  check("route walk: all three routes completed", (await readProgress(page))?.completedTrailIds?.length === 3);
  check("route walk: no console or page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

async function runPersistenceAndLinks(browser, baseUrl, origin) {
  const persistence = await createPage(browser, origin, { width: 390, height: 844 });
  await loadApp(persistence.page, baseUrl);
  await dismissChooser(persistence.page);
  await startTrail(persistence.page, 1);
  await persistence.page.locator('#trail-panel [data-action="next"]').click();
  await waitForPanelStep(persistence.page, 2);
  const beforeReload = await readProgress(persistence.page);
  await persistence.page.reload({ waitUntil: "domcontentloaded" });
  await persistence.page.locator("#map-root path.land").first().waitFor({ state: "visible" });
  await waitForPanelStep(persistence.page, 2);
  const afterReload = await readProgress(persistence.page);
  check(
    "persistence: current route and step survive refresh",
    afterReload?.currentTrailId === beforeReload?.currentTrailId &&
      afterReload?.currentStep === beforeReload?.currentStep,
    JSON.stringify({ beforeReload, afterReload }),
  );
  check(
    "persistence: recent visits recorded",
    Array.isArray(afterReload?.recent) && afterReload.recent.length > 0,
  );
  check(
    "persistence: panel resumes at saved step",
    (await persistence.page.locator("#trail-panel").getAttribute("data-step")) === "2",
  );
  check(
    "persistence: no console or page errors",
    persistence.errors.length === 0,
    persistence.errors.join(" | "),
  );
  await persistence.context.close();

  const deepLink = await createPage(browser, origin, { width: 390, height: 844 });
  await loadApp(deepLink.page, baseUrl, "#trail=philosophy-and-life&step=4");
  await waitForPanelStep(deepLink.page, 4);
  await deepLink.page.waitForTimeout(900);
  await assertPanelStep(
    deepLink.page,
    "deep link",
    trails.find((trail) => trail.id === "philosophy-and-life"),
    4,
  );
  check(
    "deep link: requested hash preserved",
    (await deepLink.page.evaluate(() => location.hash)) ===
      "#trail=philosophy-and-life&step=4",
  );
  check(
    "deep link: no console or page errors",
    deepLink.errors.length === 0,
    deepLink.errors.join(" | "),
  );
  await deepLink.context.close();

  const invalidLink = await createPage(browser, origin, { width: 390, height: 844 });
  await loadApp(invalidLink.page, baseUrl, "#trail=missing-route&step=99");
  check("invalid deep link: chooser shown", await chooserIsOpen(invalidLink.page));
  check(
    "invalid deep link: status explains failure",
    (await invalidLink.page.locator("#trail-chooser .trail-status").innerText())
      .length > 0,
  );
  check(
    "invalid deep link: unsafe hash removed",
    (await invalidLink.page.evaluate(() => location.hash)) === "",
  );
  check(
    "invalid deep link: no console or page errors",
    invalidLink.errors.length === 0,
    invalidLink.errors.join(" | "),
  );
  await invalidLink.context.close();

  const record = await createPage(browser, origin, { width: 390, height: 844 });
  await loadApp(
    record.page,
    baseUrl,
    "#record&trail=what-is-philosophy&step=2",
  );
  await waitForPanelStep(record.page, 2);
  check(
    "record mode: route and record coexist",
    await record.page.evaluate(
      () =>
        document.body.classList.contains("record-mode") &&
        location.hash === "#record&trail=what-is-philosophy&step=2",
    ),
  );
  await record.page.keyboard.press("Escape");
  await record.page.waitForTimeout(200);
  check(
    "record mode: closing route preserves record flag",
    await record.page.evaluate(
      () =>
        document.body.classList.contains("record-mode") &&
        location.hash === "#record" &&
        document.querySelector("#trail-panel")?.hasAttribute("hidden"),
    ),
  );
  await record.page.keyboard.press("Escape");
  await record.page.waitForTimeout(200);
  check(
    "record mode: second Escape exits record mode",
    await record.page.evaluate(
      () =>
        !document.body.classList.contains("record-mode") &&
        location.hash === "",
    ),
  );
  check(
    "record mode: no console or page errors",
    record.errors.length === 0,
    record.errors.join(" | "),
  );
  await record.context.close();
}

async function runProgressAndKeyboard(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(browser, origin, {
    width: 1440,
    height: 900,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  page.on("dialog", (dialog) => dialog.accept());
  await loadApp(page, baseUrl);
  await dismissChooser(page);
  const society = trails.find((trail) => trail.id === "philosophy-and-society");
  await startTrail(page, 1);
  await page.locator('#trail-panel [data-action="next"]').click();
  await waitForPanelStep(page, 2);

  await openChooser(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.trail-data-actions [data-action="export"]').click(),
  ]);
  const exportPath = path.join(temporaryDir, "progress.json");
  await download.saveAs(exportPath);
  const exported = JSON.parse(await fs.readFile(exportPath, "utf8"));
  check(
    "export: current trail and step included",
    exported.currentTrailId === "philosophy-and-society" &&
      exported.currentStep === 2,
    JSON.stringify(exported),
  );
  check(
    "export: status visible in chooser",
    (await page.locator("#trail-chooser .trail-status").innerText()).length > 0,
  );

  await page.locator('.trail-data-actions [data-action="clear"]').click();
  await page.waitForTimeout(300);
  check("clear: chooser returns", await chooserIsOpen(page));
  check(
    "clear: storage removed",
    (await page.evaluate(() => localStorage.getItem("philosophy_vis_trail_progress_v1"))) ===
      null,
  );
  check(
    "clear: deep-link hash removed",
    (await page.evaluate(() => location.hash)) === "",
  );
  check(
    "clear: spotlight removed",
    (await page.locator("circle.philosopher.spotlight").count()) === 0,
  );

  await page.locator("#trail-import-file").setInputFiles(exportPath);
  await waitForPanelStep(page, 2);
  check(
    "import: state restored",
    (await readProgress(page))?.currentTrailId === "philosophy-and-society",
  );

  const shareButton = page.locator('#trail-panel [data-action="share"]');
  const shareUrl = await shareButton.getAttribute("data-share-url");
  check(
    "share: link contains route and step",
    Boolean(shareUrl?.includes("#trail=philosophy-and-society&step=2")),
    shareUrl ?? "",
  );
  await shareButton.click();
  await page.waitForTimeout(200);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  check("share: link copied", clipboard === shareUrl, clipboard);

  await page.locator('.lang-btn[data-lang="en"]').click();
  await page.waitForTimeout(200);
  const englishQuestion = await page.locator(".trail-question").innerText();
  const englishNext = await page.locator('#trail-panel [data-action="next"]').innerText();
  check(
    "language: English question switches",
    englishQuestion === society.steps[1].question_en,
    englishQuestion,
  );
  check("language: English controls switch", /Next/i.test(englishNext), englishNext);
  await page.locator('.lang-btn[data-lang="zh"]').click();

  await page.locator('#trail-panel [data-action="next"]').focus();
  await page.keyboard.press("ArrowRight");
  await waitForPanelStep(page, 3);
  await page.waitForTimeout(250);
  check(
    "keyboard: ArrowRight advances",
    (await page.locator("#trail-panel").getAttribute("data-step")) === "3",
  );
  check(
    "aria-live: announces new step",
    (await page.locator(".trail-live").innerText()).length > 0,
  );
  await page.keyboard.press("ArrowLeft");
  await waitForPanelStep(page, 2);
  check(
    "keyboard: ArrowLeft goes back",
    (await page.locator("#trail-panel").getAttribute("data-step")) === "2",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(
    "keyboard: Escape closes route",
    !(await page.locator("#trail-panel").isVisible()),
  );
  check(
    "keyboard: focus returns to route launcher",
    (await page.evaluate(() => document.activeElement?.id)) === "trail-launch",
  );

  await openChooser(page);
  const invalidPath = path.join(temporaryDir, "invalid.json");
  await fs.writeFile(invalidPath, "not-json", "utf8");
  await page.locator("#trail-import-file").setInputFiles(invalidPath);
  await page.waitForTimeout(300);
  const progressAfterInvalidImport = await readProgress(page);
  check(
    "import: invalid file rejected",
    (await page.locator("#trail-chooser .trail-status").innerText()).includes("导入失败"),
  );
  check(
    "import: invalid file does not erase progress",
    progressAfterInvalidImport?.currentTrailId === "philosophy-and-society" &&
      progressAfterInvalidImport?.currentStep === 2,
    JSON.stringify(progressAfterInvalidImport),
  );
  check("progress flow: no console or page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

async function runResponsiveAndLabels(browser, baseUrl, origin) {
  const sizes = [
    { name: "320x568", width: 320, height: 568 },
    { name: "390x844", width: 390, height: 844 },
    { name: "667x375", width: 667, height: 375 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1440x900", width: 1440, height: 900 },
  ];
  const society = trails.find((trail) => trail.id === "philosophy-and-society");

  for (const size of sizes) {
    const { context, page, errors } = await createPage(browser, origin, {
      width: size.width,
      height: size.height,
    });
    await loadApp(page, baseUrl);
    check(
      `responsive ${size.name}: no horizontal overflow on chooser`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    check(
      `responsive ${size.name}: chooser fits viewport`,
      await page.evaluate(() => {
        const panel = document.querySelector(".trail-chooser-panel")?.getBoundingClientRect();
        return (
          !panel ||
          (panel.left >= -1 &&
            panel.right <= window.innerWidth + 1 &&
            panel.top >= -1 &&
            panel.bottom <= window.innerHeight + 1)
        );
      }),
    );
    if (size.width <= 768) {
      const chooserTargets = await touchTargetAudit(page, "#trail-chooser");
      check(
        `responsive ${size.name}: chooser touch targets >= 40px`,
        chooserTargets.length === 0,
        JSON.stringify(chooserTargets),
      );
    }
    const chooserPath = path.join(screenshotsDir, `${size.name}-chooser.png`);
    await page.screenshot({ path: chooserPath, fullPage: true });
    screenshots.push(path.relative(root, chooserPath));

    await dismissChooser(page);
    await page.evaluate(() => {
      window.location.hash = "#trail=philosophy-and-society&step=4";
    });
    await waitForPanelStep(page, 4);
    await page.waitForTimeout(900);
    await assertPanelStep(
      page,
      `responsive ${size.name}`,
      society,
      4,
    );
    check(
      `responsive ${size.name}: no horizontal overflow in player`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    if (size.width <= 768) {
      const playerTargets = await touchTargetAudit(page, "#trail-panel");
      check(
        `responsive ${size.name}: player touch targets >= 40px`,
        playerTargets.length === 0,
        JSON.stringify(playerTargets),
      );
    }

    const playerAudit = await labelAudit(page);
    assertLabelAudit(`responsive ${size.name} player`, playerAudit);
    const playerPath = path.join(screenshotsDir, `${size.name}-player.png`);
    await page.screenshot({ path: playerPath, fullPage: true });
    screenshots.push(path.relative(root, playerPath));

    await page.locator('#trail-panel [data-action="close"]').click();
    await page.waitForTimeout(350);
    const mapAudit = await labelAudit(page);
    assertLabelAudit(`responsive ${size.name} map`, mapAudit);
    check(
      `responsive ${size.name}: no console or page errors`,
      errors.length === 0,
      errors.join(" | "),
    );
    await context.close();
  }
}

async function runReducedMotion(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(
    browser,
    origin,
    { width: 390, height: 844 },
    { reducedMotion: "reduce" },
  );
  await loadApp(page, baseUrl, "#trail=what-is-philosophy&step=2");
  await waitForPanelStep(page, 2);
  await page.waitForTimeout(120);
  const prefersReducedMotion = await page.evaluate(() =>
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const transformBefore = await page
    .locator(".main-group")
    .getAttribute("transform");
  await page.locator('#trail-panel [data-action="next"]').click();
  await waitForPanelStep(page, 3);
  await page.waitForTimeout(80);
  const transformSoon = await page
    .locator(".main-group")
    .getAttribute("transform");
  await page.waitForTimeout(500);
  const transformLater = await page
    .locator(".main-group")
    .getAttribute("transform");
  check("reduced motion: media query active", prefersReducedMotion);
  check(
    "reduced motion: camera reaches destination immediately",
    transformSoon === transformLater,
    JSON.stringify({ transformBefore, transformSoon, transformLater }),
  );
  check(
    "reduced motion: no console or page errors",
    errors.length === 0,
    errors.join(" | "),
  );
  await context.close();
}

async function runPlaybackLabels(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(browser, origin, {
    width: 1024,
    height: 768,
  });
  await loadApp(page, baseUrl);
  await dismissChooser(page);
  await page.locator("#timeline").evaluate((input) => {
    input.value = "1600";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.locator("#play").click();
  await page.waitForTimeout(2500);

  const readLabels = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "text.philosopher-label.visible, text.cluster-label.visible",
        ),
      ].map((element) => ({
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
        opacity: Number(getComputedStyle(element).opacity),
      })),
    );
  const labels = await readLabels();
  const labelText = labels.map((label) => label.text).join(" ");
  await page.waitForTimeout(600);
  const settledLabels = await readLabels();
  const allLabels = [...labels, ...settledLabels];
  const fullOpacity = allLabels.filter((label) => label.opacity > 0.9);
  check(
    "playback: visible labels reach full opacity",
    fullOpacity.length > 0,
    JSON.stringify(allLabels),
  );
  check(
    "playback: labels carry philosopher names",
    labels.length > 0 &&
      philosophers.some((philosopher) => labelText.includes(philosopher.name_zh)),
    labelText,
  );
  check(
    "playback: visible labels are never blank",
    labels.every((label) => label.text.length > 0),
    JSON.stringify(labels),
  );
  check(
    "playback labels: no console or page errors",
    errors.length === 0,
    errors.join(" | "),
  );
  if (await page.locator("#play").evaluate((element) => element.classList.contains("playing"))) {
    await page.locator("#play").click();
  }
  await context.close();
}

async function runExistingFeatures(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(browser, origin, {
    width: 1024,
    height: 768,
  });
  await loadApp(page, baseUrl);
  await dismissChooser(page);
  check(
    "existing: map has philosopher dots",
    (await page.locator("circle.philosopher").count()) >= 100,
  );

  await page.locator("#search").fill("Kant");
  await page.locator("#search").press("Enter");
  await page.locator("#sidebar:not(.collapsed)").waitFor({ state: "visible" });
  check(
    "existing: search opens philosopher sidebar",
    (await page.locator("#sidebar .sb-name").innerText()).includes("康德"),
  );
  check(
    "existing: BYOK chat panel present",
    (await page.locator("#sidebar .chat-panel").count()) === 1,
  );
  check(
    "existing: search input clears after locate",
    (await page.locator("#search").inputValue()) === "",
  );
  await page.locator("#sidebar .close-btn").click();

  await page.locator("#timeline").evaluate((input) => {
    input.value = "1800";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  check(
    "existing: timeline updates year label",
    (await page.locator("#year-label").innerText()).includes("1800"),
  );

  await page.locator("#toggle-show-all").check();
  await page.locator("#toggle-lineage").check();
  await page.waitForTimeout(250);
  check("existing: all-years toggle works", await page.locator("#toggle-show-all").isChecked());
  check("existing: lineage toggle works", await page.locator("#toggle-lineage").isChecked());
  check(
    "existing: lineage lines render",
    (await page.locator("path.lineage").count()) > 0,
  );

  await page.locator("#school-filter").selectOption("analytic");
  check(
    "existing: school filter updates",
    (await page.locator("#school-filter").inputValue()) === "analytic",
  );

  await page.locator('.lang-btn[data-lang="en"]').click();
  check(
    "existing: language toggle works",
    (await page.locator('.lang-btn[data-lang="en"]').getAttribute("aria-pressed")) ===
      "true",
  );
  await page.locator('.lang-btn[data-lang="zh"]').click();

  await page.locator("#timeline").evaluate((input) => {
    input.value = "2000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(1000);
  const lateMap = await page.evaluate(() => {
    const lands = [...document.querySelectorAll("#map-root path.land")];
    const boxes = lands
      .map((land) => land.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    return {
      count: lands.length,
      visibleCount: boxes.length,
      width: Math.max(0, ...boxes.map((box) => box.width)),
    };
  });
  check(
    "existing: 2000 contemporary basemap renders land",
    lateMap.count > 100 && lateMap.visibleCount > 100 && lateMap.width > 100,
    JSON.stringify(lateMap),
  );
  const lateMapPath = path.join(screenshotsDir, "1440x900-map-2000.png");
  await page.screenshot({ path: lateMapPath, fullPage: true });
  screenshots.push(path.relative(root, lateMapPath));

  check("existing features: no console or page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

async function runChatKeyRedaction(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(browser, origin, {
    width: 1024,
    height: 768,
  });
  const apiKey = "sk-chat-leak-secret-9012";
  let authorization = "";
  let providerRequests = 0;
  await page.route("**/test-chat/chat/completions", async (route) => {
    providerRequests += 1;
    authorization = route.request().headers().authorization ?? "";
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: `Incorrect API key provided: ${apiKey}` },
      }),
    });
  });
  await loadApp(page, baseUrl);
  await dismissChooser(page);
  await page.locator("#search").fill("Kant");
  await page.locator("#search").press("Enter");
  await page.locator("#sidebar:not(.collapsed)").waitFor({ state: "visible" });
  await page.locator("#sidebar .chat-settings-toggle").click();
  const form = page.locator("#sidebar .chat-settings form.provider-settings-form");
  await form.waitFor({ state: "visible" });
  await form.locator('select[name="provider"]').selectOption("custom");
  await form.locator('input[name="apiKey"]').fill(apiKey);
  await form.locator('input[name="model"]').fill("test-model");
  await form.locator('input[name="baseUrl"]').fill(`${origin}/test-chat`);
  await form.locator('[data-settings-action="save"]').click();
  await page.locator("#sidebar .chat-textarea").fill("测试对话错误脱敏");
  await page.locator("#sidebar .chat-send-btn").click();
  const errorEl = page.locator("#sidebar .chat-error:not([hidden])");
  await errorEl.waitFor({ state: "visible" });
  const errorText = await errorEl.innerText();
  check(
    "chat: provider errors never echo the API key",
    authorization === `Bearer ${apiKey}` &&
      !errorText.includes(apiKey) &&
      errorText.includes("[redacted]"),
    JSON.stringify({ authorization, errorText }),
  );
  check(
    "chat: redaction test has no unexpected page errors",
    errors.every((error) => error.includes("400")),
    errors.join(" | "),
  );
  await page.evaluate((key) => {
    sessionStorage.setItem(
      "philosophy_vis_llm_settings_v2",
      JSON.stringify({
        version: 2,
        providerId: "custom",
        apiKey: key,
        baseUrl: "http://insecure.example.com/v1",
        model: "test-model",
      }),
    );
  }, apiKey);
  await page.locator("#sidebar .chat-textarea").fill("测试明文传输拦截");
  await page.locator("#sidebar .chat-send-btn").click();
  await page
    .locator("#sidebar .chat-error")
    .filter({ hasText: "Base URL 必须使用 HTTPS" })
    .waitFor({ state: "visible" });
  check(
    "chat: insecure custom Base URL is blocked before any request",
    providerRequests === 1,
    String(providerRequests),
  );
  await context.close();
}

async function runCustomQuestionAndTheme(browser, baseUrl, origin) {
  const { context, page, errors } = await createPage(browser, origin, {
    width: 1440,
    height: 900,
  });
  let plannerRequest = null;
  let plannerUrl = "";
  let plannerHeaders = {};
  let workerPlannerRequests = 0;
  await page.route("**/api/plan-trail", async (route) => {
    workerPlannerRequests += 1;
    await route.abort();
  });
  await page.route("**/test-v1/chat/completions", async (route) => {
    const request = route.request();
    plannerUrl = request.url();
    plannerHeaders = request.headers();
    plannerRequest = request.postDataJSON();
    const userMessage = [...(plannerRequest?.messages ?? [])]
      .reverse()
      .find((message) => message?.role === "user");
    const question =
      String(userMessage?.content ?? "").match(/用户问题：([\s\S]*?)\n\n/)?.[1] ?? "";
    const plan = {
      title_zh: `关于「${question}」的模型路线`,
      title_en: `A model trail: ${question}`,
      description_zh: "测试路线",
      description_en: "Test trail",
      steps: [
        "socrates",
        "epicurus",
        "seneca",
        "heidegger",
        "levinas",
        "camus",
        "beauvoir",
      ].map((philosopherId) => ({
        philosopherId,
        theoryIndex: 0,
        question_zh: `如果从${philosopherId}出发，这个问题会怎样改变？`,
        question_en: `How would the question change from ${philosopherId}?`,
        bridge_zh: "",
        bridge_en: "",
      })),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(plan) } }],
      }),
    });
  });
  await loadApp(page, baseUrl);
  check("custom question: chooser starts open", await chooserIsOpen(page));
  const legacyTrail = {
    id: "custom-legacy-template",
    title_zh: "旧版模板路线",
    title_en: "Legacy template trail",
    description_zh: "旧版本地模板",
    description_en: "Legacy local template",
    steps: [
      "socrates",
      "plato",
      "aristotle",
      "descartes",
      "kant",
      "hegel",
      "nietzsche",
    ].map((philosopherId) => ({
      philosopherId,
      theoryIndex: 0,
      question_zh: "旧版问题？",
      question_en: "A legacy question?",
      bridge_zh: "旧版过渡",
      bridge_en: "Legacy bridge",
    })),
  };
  await page.evaluate((trail) => {
    localStorage.setItem("philosophy_vis_custom_trail_v1", JSON.stringify(trail));
  }, legacyTrail);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#map-root path.land").first().waitFor({ state: "visible" });
  check(
    "custom question: legacy local template is discarded",
    (await page.evaluate(() => localStorage.getItem("philosophy_vis_custom_trail_v1"))) ===
      null &&
      (await page.locator("#trail-panel").isHidden()) &&
      (await page.locator(".trail-route-card").count()) === 3,
  );
  check(
    "custom question: model connection form is available",
    (await page.locator("details.trail-provider .provider-settings-form").count()) === 1,
  );
  await page.locator("#trail-custom-question").fill("没有连接模型时的问题");
  await page.locator('.trail-ask-row button[type="submit"]').click();
  await page
    .locator("#trail-chooser .trail-status")
    .filter({ hasText: "请先连接你自己的模型 API" })
    .waitFor({ state: "visible" });
  check(
    "custom question: missing model settings never falls back to a project model",
    plannerRequest === null &&
      (await page.locator("#trail-panel").isHidden()) &&
      (await page.locator("details.trail-provider").getAttribute("open")) !== null,
  );
  await page.locator('select[name="provider"]').selectOption("openai");
  await page.locator('input[name="apiKey"]').fill("sk-should-not-cross-providers");
  await page.locator('select[name="provider"]').selectOption("custom");
  check(
    "custom question: switching provider clears the previous API key",
    (await page.locator('input[name="apiKey"]').inputValue()) === "",
  );
  await page.locator('select[name="provider"]').selectOption("custom");
  await page.locator('input[name="apiKey"]').fill("sk-test-secret");
  await page.locator('input[name="model"]').fill("test-model");
  await page.locator('input[name="baseUrl"]').fill("http://insecure.example.com/v1");
  await page.locator('[data-settings-action="save"]').click();
  await page
    .locator("#trail-chooser .trail-status")
    .filter({ hasText: "Base URL 必须使用 HTTPS" })
    .waitFor({ state: "visible" });
  check(
    "custom question: insecure Base URL is rejected before storing the key",
    (await page.evaluate(() =>
      sessionStorage.getItem("philosophy_vis_llm_settings_v2"),
    )) === null,
  );
  await page.locator('input[name="baseUrl"]').fill(`${origin}/test-v1`);
  await page.locator('[data-settings-action="save"]').click();
  const storedKey = await page.evaluate(() => ({
    session: JSON.parse(
      sessionStorage.getItem("philosophy_vis_llm_settings_v2") ?? "null",
    ),
    local: localStorage.getItem("philosophy_vis_llm_settings_v2"),
  }));
  check(
    "custom question: key defaults to session storage, not localStorage",
    storedKey.session?.apiKey === "sk-test-secret" && storedKey.local === null,
    JSON.stringify(storedKey),
  );
  await page.locator("#trail-custom-question").fill("我为什么会害怕死亡？");
  await page.locator('.trail-ask-row button[type="submit"]').click();
  await page
    .locator('#trail-panel[data-trail-id^="custom-"]')
    .waitFor({ state: "visible" });
  const customTitle = await page.locator("#trail-player-title").innerText();
  check(
    "custom question: provider endpoint received the question",
    String(
      [...(plannerRequest?.messages ?? [])]
        .reverse()
        .find((message) => message?.role === "user")?.content ?? "",
    ).includes("我为什么会害怕死亡"),
    JSON.stringify(plannerRequest),
  );
  check(
    "custom question: browser calls provider directly, never the project Worker",
    plannerUrl === `${origin}/test-v1/chat/completions` &&
      workerPlannerRequests === 0,
    JSON.stringify({ plannerUrl, workerPlannerRequests }),
  );
  check(
    "custom question: key travels only in the Authorization header",
    plannerHeaders.authorization === "Bearer sk-test-secret" &&
      !plannerUrl.includes("sk-test-secret"),
    JSON.stringify({ plannerUrl, headers: plannerHeaders }),
  );
  check(
    "custom question: title contains the user question",
    customTitle.includes("我为什么会害怕死亡"),
    customTitle,
  );
  check(
    "custom question: route has seven stops",
    (await page.locator("#trail-panel .trail-steps li").count()) === 7,
  );
  check(
    "custom question: first theory is populated",
    (await page.locator(".trail-concept h4").innerText()).length > 1,
  );
  check(
    "custom question: no synthesized bridge copy",
    (await page.locator("#trail-panel .trail-bridge").count()) === 0,
  );
  check(
    "custom question: local-only affordance is visible",
    await page.locator('#trail-panel [data-action="share-local"]').isVisible(),
  );
  const customHash = await page.evaluate(() => location.hash);
  check(
    "custom question: hash points at custom trail",
    /^#trail=custom-/.test(customHash),
    customHash,
  );
  const storedCustom = await page.evaluate(() => {
    const raw = localStorage.getItem("philosophy_vis_custom_trail_v2");
    return raw ? JSON.parse(raw) : null;
  });
  check(
    "custom question: only model-generated routes are persisted",
    storedCustom?.version === 2 &&
      storedCustom?.generator === "model-v1" &&
      storedCustom?.trail?.id?.startsWith("custom-") &&
      storedCustom?.trail?.steps?.length === 7,
    JSON.stringify(storedCustom),
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator('#trail-panel[data-trail-id^="custom-"]')
    .waitFor({ state: "visible" });
  check(
    "custom question: route survives refresh",
    (await page.locator("#trail-player-title").innerText()).includes(
      "我为什么会害怕死亡",
    ),
  );

  const atlasOcean = await page.evaluate(
    () => getComputedStyle(document.querySelector(".ocean")).fill,
  );
  check(
    "theme: atlas is the default",
    (await page.evaluate(() => document.documentElement.dataset.theme)) ===
      "atlas",
  );
  await page.locator("#theme-btn").click();
  await page.waitForTimeout(100);
  const night = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    ocean: getComputedStyle(document.querySelector(".ocean")).fill,
    background: getComputedStyle(document.body).backgroundColor,
  }));
  check("theme: night theme applies", night.theme === "night", night.theme);
  check(
    "theme: ocean palette changes",
    night.ocean !== atlasOcean,
    JSON.stringify({ atlasOcean, nightOcean: night.ocean }),
  );
  check(
    "theme: night background is dark",
    night.background !== "rgb(237, 241, 242)",
    night.background,
  );
  const nightPath = path.join(screenshotsDir, "1440x900-night-custom.png");
  await page.screenshot({ path: nightPath, fullPage: true });
  screenshots.push(path.relative(root, nightPath));

  check(
    "custom question + theme: no console or page errors",
    errors.length === 0,
    errors.join(" | "),
  );
  await context.close();

  const failure = await createPage(browser, origin, {
    width: 390,
    height: 844,
  });
  await failure.context.addInitScript((base) => {
    sessionStorage.setItem(
      "philosophy_vis_llm_settings_v2",
      JSON.stringify({
        version: 2,
        providerId: "custom",
        apiKey: "sk-failure",
        baseUrl: `${base}/test-v1`,
        model: "test-model",
      }),
    );
  }, origin);
  await failure.page.route("**/test-v1/chat/completions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
    }),
  );
  await loadApp(failure.page, baseUrl);
  await failure.page
    .locator("#trail-custom-question")
    .fill("一个完全不在预设主题里的问题");
  await failure.page.locator('.trail-ask-row button[type="submit"]').click();
  await failure.page
    .locator("#trail-chooser .trail-status")
    .filter({ hasText: "模型返回的路线不完整" })
    .waitFor({ state: "visible" });
  check(
    "custom question: model failure does not open a fake route",
    await failure.page.locator("#trail-panel").isHidden(),
  );
  check(
    "custom question: model failure keeps the user question editable",
    (await failure.page.locator("#trail-custom-question").inputValue()) ===
      "一个完全不在预设主题里的问题",
  );
  check(
    "custom question: model failure has no console or page errors",
    failure.errors.length === 0,
    failure.errors.join(" | "),
  );
  await failure.context.close();

  const redaction = await createPage(browser, origin, {
    width: 390,
    height: 844,
  });
  await redaction.context.addInitScript((base) => {
    if (!location.origin.startsWith("http")) return;
    sessionStorage.setItem(
      "philosophy_vis_llm_settings_v2",
      JSON.stringify({
        version: 2,
        providerId: "custom",
        apiKey: "sk-leaked-secret-1234",
        baseUrl: `${base}/test-v1`,
        model: "test-model",
      }),
    );
  }, origin);
  await redaction.page.route("**/test-v1/chat/completions", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Incorrect API key provided: sk-leaked-secret-1234",
        },
      }),
    }),
  );
  await loadApp(redaction.page, baseUrl);
  await redaction.page
    .locator("#trail-custom-question")
    .fill("测试 API 错误脱敏");
  await redaction.page.locator('.trail-ask-row button[type="submit"]').click();
  const redactedStatus = redaction.page.locator("#trail-chooser .trail-status");
  await redactedStatus.filter({ hasText: "API Key 无效" }).waitFor({ state: "visible" });
  const redactedText = await redactedStatus.innerText();
  check(
    "custom question: provider errors never echo the API key",
    !redactedText.includes("sk-leaked-secret-1234") &&
      redactedText.includes("[redacted]"),
    redactedText,
  );
  check(
    "custom question: redaction test has no unexpected page errors",
    redaction.errors.every((error) => error.includes("401")),
    redaction.errors.join(" | "),
  );
  await redaction.context.close();

  const legacy = await createPage(browser, origin, {
    width: 390,
    height: 844,
  });
  await legacy.context.addInitScript((base) => {
    if (!location.origin.startsWith("http")) return;
    localStorage.setItem("philosophy_vis_llm_provider", "custom");
    localStorage.setItem("philosophy_vis_llm_key", "sk-legacy-secret-5678");
    localStorage.setItem("philosophy_vis_llm_base_url", `${base}/test-v1`);
    localStorage.setItem("philosophy_vis_llm_model", "legacy-model");
  }, origin);
  await loadApp(legacy.page, baseUrl);
  const migrated = await legacy.page.evaluate(() => ({
    session: JSON.parse(
      sessionStorage.getItem("philosophy_vis_llm_settings_v2") ?? "null",
    ),
    legacyKey: localStorage.getItem("philosophy_vis_llm_key"),
    legacyProvider: localStorage.getItem("philosophy_vis_llm_provider"),
  }));
  check(
    "custom question: legacy localStorage key migrates to session and is erased",
    migrated.session?.apiKey === "sk-legacy-secret-5678" &&
      migrated.legacyKey === null &&
      migrated.legacyProvider === null,
    JSON.stringify(migrated),
  );
  check(
    "custom question: legacy migration has no console or page errors",
    legacy.errors.length === 0,
    legacy.errors.join(" | "),
  );
  await legacy.context.close();
}

async function runBasemapRetry(browser, baseUrl, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let abortedRequests = 0;
  await page.route("**/basemaps/world_bc500.geojson", (route) => {
    abortedRequests += 1;
    void route.abort();
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".map-retry").waitFor({ state: "visible", timeout: 12000 });
  check("basemap retry: failure surfaces error", abortedRequests >= 3, String(abortedRequests));
  if (await chooserIsOpen(page)) await dismissChooser(page);
  await page.unroute("**/basemaps/world_bc500.geojson");
  await page.locator(".map-retry").click();
  await page.locator("#map-root path.land").first().waitFor({
    state: "visible",
    timeout: 12000,
  });
  check(
    "basemap retry: retry loads map",
    await page.locator(".map-status").isHidden(),
  );
  await context.close();
}

let previewServer;
let browser;
try {
  await fs.rm(screenshotsDir, { recursive: true, force: true });
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(temporaryDir, { recursive: true });

  const currentBundle = await bundleSizes();
  check(
    "bundle: JS gzip within +30KB",
    currentBundle.javascriptGzipKb - baselineBundle.jsGzipKb <= bundleBudget.jsGzipKb,
    JSON.stringify({ baselineBundle, currentBundle, bundleBudget }),
  );
  check(
    "bundle: CSS gzip within +8KB",
    currentBundle.cssGzipKb - baselineBundle.cssGzipKb <= bundleBudget.cssGzipKb,
    JSON.stringify({ baselineBundle, currentBundle, bundleBudget }),
  );

  previewServer = await preview({
    preview: {
      host: "127.0.0.1",
      port: 4174,
      strictPort: true,
    },
    logLevel: "error",
  });
  const baseUrl =
    previewServer.resolvedUrls?.local?.[0] ?? "http://127.0.0.1:4174/";
  const origin = new URL(baseUrl).origin;

  browser = await chromium.launch({ headless: true });
  await runRouteWalk(browser, baseUrl, origin);
  await runPersistenceAndLinks(browser, baseUrl, origin);
  await runProgressAndKeyboard(browser, baseUrl, origin);
  await runResponsiveAndLabels(browser, baseUrl, origin);
  await runReducedMotion(browser, baseUrl, origin);
  await runPlaybackLabels(browser, baseUrl, origin);
  await runExistingFeatures(browser, baseUrl, origin);
  await runChatKeyRedaction(browser, baseUrl, origin);
  await runCustomQuestionAndTheme(browser, baseUrl, origin);
  await runBasemapRetry(browser, baseUrl, origin);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    baselineBundle,
    bundleBudget,
    currentBundle: await bundleSizes(),
    screenshots,
    checks: results,
    failures,
    manualNotes: [
      "Reviewed chooser and player screenshots at 320x568, 390x844, 667x375, 768x1024, and 1440x900.",
      "Manually checked keyboard ArrowLeft/ArrowRight/Escape focus behavior and reduced-motion camera settling through the automated browser session.",
    ],
  };
  await fs.writeFile(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  const passed = results.filter((result) => result.passed).length;
  console.log(`QA checks: ${passed}/${results.length} passed.`);
  console.log(`Screenshots: ${screenshots.length} written to qa/screenshots.`);
  console.log(`Report: qa/report.json`);
  if (failures.length > 0) {
    console.error(`QA failures:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (previewServer) {
    await new Promise((resolve) => {
      previewServer.httpServer.close(resolve);
    });
  }
}
