import * as d3 from "d3";

import philosophersData from "../data/philosophers.json";
import schoolsData from "../data/schools.json";
import type { Philosopher, School, Era } from "../utils/types";
import { store } from "../utils/store";
import { lifespanProximity } from "../utils/i18n";
import { eraForYear, loadBasemap } from "../utils/eras";

const philosophers = (philosophersData.philosophers as Philosopher[]).slice();
const schools = (schoolsData.schools as School[]).slice();
const schoolById = new Map(schools.map((s) => [s.id, s]));

function colorFor(p: Philosopher): string {
  const sid = p.schools[0];
  return schoolById.get(sid)?.color ?? "#666";
}

function radiusFor(p: Philosopher): number {
  switch (p.influence_tier) {
    case 1:
      return 6;
    case 2:
      return 4.5;
    default:
      return 3.5;
  }
}

type Datum = Philosopher & {
  _x: number;
  _y: number;
  _anchorX: number;
  _anchorY: number;
  _cityKey: string;
};

interface CityCluster {
  key: string;
  nameZh: string;
  nameEn: string;
  x: number;
  y: number;
  members: Datum[];
}

interface LabelCandidate {
  kind: "person" | "cluster";
  element: SVGTextElement;
  priority: number;
  force: boolean;
}

interface Anchor {
  x: number;
  y: number;
}

type LandLayer = "A" | "B";

function measureRoot(rootEl: HTMLElement): { width: number; height: number } {
  const rect = rootEl.getBoundingClientRect();
  return {
    width: Math.max(
      1,
      Math.round(rect.width || rootEl.clientWidth || window.innerWidth || 320),
    ),
    height: Math.max(
      1,
      Math.round(
        rect.height || rootEl.clientHeight || window.innerHeight * 0.6 || 320,
      ),
    ),
  };
}

function featuresFrom(data: unknown): unknown[] {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error("basemap contains no features");
  }
  return features;
}

export async function initMap(rootEl: HTMLElement): Promise<void> {
  let { width, height } = measureRoot(rootEl);

  const svg = d3
    .select(rootEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr("aria-label", "哲学家活动地点世界地图");

  const statusEl = document.createElement("div");
  statusEl.className = "map-status";
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
  statusEl.hidden = true;
  const statusText = document.createElement("span");
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "map-retry";
  retryBtn.textContent = "重试";
  retryBtn.hidden = true;
  statusEl.append(statusText, retryBtn);
  rootEl.append(statusEl);

  const ocean = svg.append("rect").attr("class", "ocean");

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);

  const mainGroup = svg.append("g").attr("class", "main-group");

  const graticule = d3.geoGraticule().step([20, 20]);
  const graticulePath = mainGroup
    .append("path")
    .attr("class", "graticule")
    .datum(graticule());

  const landWrap = mainGroup.append("g").attr("class", "land-wrap");
  const landGroups: Record<
    LandLayer,
    d3.Selection<SVGGElement, unknown, null, undefined>
  > = {
    A: landWrap.append("g").attr("class", "land-group land-a").style("opacity", 0),
    B: landWrap.append("g").attr("class", "land-group land-b").style("opacity", 0),
  };
  const loadedLand: Record<LandLayer, unknown[] | null> = { A: null, B: null };
  let activeLand: LandLayer = "A";

  mainGroup.append("g").attr("class", "lineage-group");
  const anchorsGroup = mainGroup.append("g").attr("class", "anchors-group");
  const dotsGroup = mainGroup.append("g").attr("class", "dots-group");
  const hitGroup = mainGroup.append("g").attr("class", "hit-group");
  const labelsGroup = mainGroup.append("g").attr("class", "labels-group");
  const spokesGroup = mainGroup
    .insert("g", ".dots-group")
    .attr("class", "spokes-group");

  let currentZoom = 1;
  let currentTransform = d3.zoomIdentity;
  let zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>;
  let cityClusters: CityCluster[] = [];
  let labelsExpanded = false;
  let lastLabelZoomBucket = 1;
  const resetViewBtn = document.getElementById(
    "reset-view",
  ) as HTMLButtonElement | null;
  const eraNameEl = document.getElementById("map-era-name");

  const LABEL_EXPAND_ZOOM = 2.2;

  const dots = () =>
    dotsGroup.selectAll<SVGCircleElement, Datum>("circle.philosopher");
  const hits = () =>
    hitGroup.selectAll<SVGCircleElement, Datum>("circle.philosopher-hit");
  const labels = () =>
    labelsGroup.selectAll<SVGTextElement, Datum>("text.philosopher-label");
  const clusterLabels = () =>
    labelsGroup.selectAll<SVGTextElement, CityCluster>("text.cluster-label");
  const spokes = () => spokesGroup.selectAll<SVGLineElement, Datum>("line.spoke");

  function applyVisualScale(): void {
    const k = currentZoom;
    const labelSize = width < 640 ? 10 : 11;
    labels()
      .style("font-size", `${labelSize / k}px`)
      .style("stroke-width", `${3 / k}`)
      .attr("y", (d) => d._y - radiusFor(d) / k - 3 / k);
    clusterLabels()
      .style("font-size", `${labelSize / k}px`)
      .style("stroke-width", `${4 / k}`)
      .attr("y", (d) => d.y - 15 / k);
    dots()
      .attr("r", (d) => radiusFor(d) / k)
      .attr("stroke-width", 0.6 / k);
    hits().attr("r", () => (width < 640 ? 18 : 12) / k);
    spokes().style("stroke-width", `${0.5 / k}`);
    anchorsGroup
      .selectAll<SVGCircleElement, unknown>("circle.anchor-dot")
      .attr("r", 1.5 / k);
    graticulePath.attr("stroke-width", 0.3 / k);
    landWrap
      .selectAll<SVGPathElement, unknown>("path.land")
      .attr("stroke-width", 0.5 / k);
  }

  function layoutMarkers(): void {
    const positioned: Datum[] = philosophers
      .map((p) => {
        const xy = projection([p.location.lng, p.location.lat]);
        if (!xy) return null;
        return {
          ...p,
          _x: xy[0],
          _y: xy[1],
          _anchorX: xy[0],
          _anchorY: xy[1],
          _cityKey: p.location.zh,
        } as Datum;
      })
      .filter((p): p is Datum => p !== null);

    // Clock-face layout for co-located dots. Spacing adapts slightly to the
    // viewport so dense cities remain legible on phones.
    const cellSize = Math.max(4, width / 160);
    const groups = new Map<string, Datum[]>();
    for (const p of positioned) {
      const key = `${Math.round(p._anchorX / cellSize)}_${Math.round(
        p._anchorY / cellSize,
      )}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const byCity = new Map<string, Datum[]>();
    for (const p of positioned) {
      if (!byCity.has(p._cityKey)) byCity.set(p._cityKey, []);
      byCity.get(p._cityKey)!.push(p);
    }
    cityClusters = [...byCity.entries()].map(([key, members]) => ({
      key,
      nameZh: members[0].location.zh,
      nameEn: members[0].location.en,
      x: d3.mean(members, (d) => d._anchorX) ?? members[0]._anchorX,
      y: d3.mean(members, (d) => d._anchorY) ?? members[0]._anchorY,
      members,
    }));

    const cityAnchors: Anchor[] = [];
    const layoutScale = Math.max(0.78, Math.min(1.25, width / 760));
    for (const group of groups.values()) {
      if (group.length === 1) continue;
      group.sort((a, b) => a.birth - b.birth);
      cityAnchors.push({ x: group[0]._anchorX, y: group[0]._anchorY });

      const baseRadius = 11 * layoutScale;
      const ringStep = 9 * layoutScale;
      const ringCapacity = 8;
      let i = 0;
      while (i < group.length) {
        const ringIdx = Math.floor(i / ringCapacity);
        const inThisRing = Math.min(
          ringCapacity,
          group.length - ringIdx * ringCapacity,
        );
        const radius = baseRadius + ringIdx * ringStep;
        for (let j = 0; j < inThisRing; j++) {
          const angle = (j / inThisRing) * 2 * Math.PI - Math.PI / 2;
          const idx = ringIdx * ringCapacity + j;
          group[idx]._x = group[idx]._anchorX + radius * Math.cos(angle);
          group[idx]._y = group[idx]._anchorY + radius * Math.sin(angle);
          i++;
        }
      }
    }

    const anchorJoin = anchorsGroup
      .selectAll<SVGGElement, Anchor>("g.anchor")
      .data(cityAnchors);
    anchorJoin.exit().remove();
    const anchorEnter = anchorJoin.enter().append("g").attr("class", "anchor");
    anchorEnter.append("circle").attr("class", "anchor-dot");
    anchorEnter
      .merge(anchorJoin)
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    const dotJoin = dotsGroup
      .selectAll<SVGCircleElement, Datum>("circle.philosopher")
      .data(positioned, (d) => d.id);
    dotJoin.exit().remove();
    const dotEnter = dotJoin
      .enter()
      .append("circle")
      .attr("class", "philosopher")
      .attr("data-id", (d) => d.id)
      .attr("fill", colorFor)
      .attr("stroke", "#1f1a14")
      .attr("opacity", 0);
    dotEnter
      .merge(dotJoin)
      .attr("cx", (d) => d._x)
      .attr("cy", (d) => d._y)
      .on("mouseenter", function (event: MouseEvent, d) {
        store.set({ hoveredId: d.id });
        d3.select(this).raise();
        window.dispatchEvent(
          new CustomEvent("philosopher:hover", {
            detail: { id: d.id, x: event.clientX, y: event.clientY },
          }),
        );
      })
      .on("mousemove", function (event: MouseEvent, d) {
        window.dispatchEvent(
          new CustomEvent("philosopher:hover", {
            detail: { id: d.id, x: event.clientX, y: event.clientY },
          }),
        );
      })
      .on("mouseleave", function () {
        store.set({ hoveredId: null });
        window.dispatchEvent(new CustomEvent("philosopher:unhover"));
      })
      .on("click", function (event: MouseEvent, d) {
        event.stopPropagation();
        const current = store.get("selectedId");
        store.set({ selectedId: current === d.id ? null : d.id });
      });

    const hitJoin = hitGroup
      .selectAll<SVGCircleElement, Datum>("circle.philosopher-hit")
      .data(positioned, (d) => d.id);
    hitJoin.exit().remove();
    hitJoin
      .enter()
      .append("circle")
      .attr("class", "philosopher-hit")
      .attr("data-id", (d) => d.id)
      .attr("fill", "transparent")
      .merge(hitJoin)
      .attr("cx", (d) => d._x)
      .attr("cy", (d) => d._y)
      .on("mouseenter", function (event: MouseEvent, d) {
        store.set({ hoveredId: d.id });
        window.dispatchEvent(
          new CustomEvent("philosopher:hover", {
            detail: { id: d.id, x: event.clientX, y: event.clientY },
          }),
        );
      })
      .on("mousemove", function (event: MouseEvent, d) {
        window.dispatchEvent(
          new CustomEvent("philosopher:hover", {
            detail: { id: d.id, x: event.clientX, y: event.clientY },
          }),
        );
      })
      .on("mouseleave", function () {
        store.set({ hoveredId: null });
        window.dispatchEvent(new CustomEvent("philosopher:unhover"));
      })
      .on("click", function (event: MouseEvent, d) {
        event.stopPropagation();
        const current = store.get("selectedId");
        store.set({ selectedId: current === d.id ? null : d.id });
      });

    const labelJoin = labelsGroup
      .selectAll<SVGTextElement, Datum>("text.philosopher-label")
      .data(positioned, (d) => d.id);
    labelJoin.exit().remove();
    const labelEnter = labelJoin
      .enter()
      .append("text")
      .attr("class", "philosopher-label")
      .attr("text-anchor", "middle");
    labelEnter
      .merge(labelJoin)
      .attr("x", (d) => d._x)
      .text((d) => (store.get("nameLang") === "en" ? d.name_en : d.name_zh));

    const clusterJoin = labelsGroup
      .selectAll<SVGTextElement, CityCluster>("text.cluster-label")
      .data(cityClusters, (d) => d.key);
    clusterJoin.exit().remove();
    clusterJoin
      .enter()
      .append("text")
      .attr("class", "cluster-label")
      .attr("text-anchor", "middle")
      .merge(clusterJoin)
      .attr("x", (d) => d.x);

    const spokeData = positioned.filter(
      (d) => d._x !== d._anchorX || d._y !== d._anchorY,
    );
    const spokeJoin = spokesGroup
      .selectAll<SVGLineElement, Datum>("line.spoke")
      .data(spokeData, (d) => d.id);
    spokeJoin.exit().remove();
    const spokeEnter = spokeJoin.enter().append("line").attr("class", "spoke");
    spokeEnter
      .merge(spokeJoin)
      .attr("x1", (d) => d._anchorX)
      .attr("y1", (d) => d._anchorY)
      .attr("x2", (d) => d._x)
      .attr("y2", (d) => d._y);

    applyVisualScale();
  }

  function syncResetButton(): void {
    if (!resetViewBtn) return;
    const moved =
      Math.abs(currentZoom - 1) > 0.01 ||
      Math.abs(currentTransform.x) > 0.5 ||
      Math.abs(currentTransform.y) > 0.5;
    resetViewBtn.hidden = !moved;
  }

  function updateViewport(
    nextWidth: number,
    nextHeight: number,
    preserveCamera: boolean,
  ): void {
    if (nextWidth <= 0 || nextHeight <= 0) return;

    const oldWidth = width;
    const oldHeight = height;
    const oldTransform = currentTransform;
    const isTransformed =
      Math.abs(oldTransform.k - 1) > 0.001 ||
      Math.abs(oldTransform.x) > 0.5 ||
      Math.abs(oldTransform.y) > 0.5;
    const oldCenter =
      preserveCamera && isTransformed
        ? projection.invert!([
            (oldWidth / 2 - oldTransform.x) / oldTransform.k,
            (oldHeight / 2 - oldTransform.y) / oldTransform.k,
          ])
        : null;

    width = nextWidth;
    height = nextHeight;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    ocean.attr("width", width).attr("height", height);

    const pad = width < 640 ? 12 : 24;
    projection.fitExtent(
      [
        [pad, pad],
        [Math.max(pad + 1, width - pad), Math.max(pad + 1, height - pad)],
      ],
      { type: "Sphere" } as never,
    );

    graticulePath.datum(graticule()).attr("d", path as never);
    (["A", "B"] as const).forEach((layer) => {
      if (!loadedLand[layer]) return;
      landGroups[layer]
        .selectAll<SVGPathElement, unknown>("path.land")
        .attr("d", path as never);
    });

    layoutMarkers();
    window.dispatchEvent(new CustomEvent("map:layout"));
    zoom.extent([
      [0, 0],
      [width, height],
    ]);

    if (!preserveCamera || !isTransformed || !oldCenter) {
      currentTransform = d3.zoomIdentity;
      currentZoom = 1;
      mainGroup.attr("transform", null);
      svg.property("__zoom", d3.zoomIdentity);
      applyVisualScale();
      syncResetButton();
      return;
    }

    const centerXY = projection(oldCenter);
    if (!centerXY) {
      currentTransform = d3.zoomIdentity;
      currentZoom = 1;
      mainGroup.attr("transform", null);
      svg.property("__zoom", d3.zoomIdentity);
      applyVisualScale();
      syncResetButton();
      return;
    }

    const k = oldTransform.k;
    const nextTransform = d3.zoomIdentity
      .translate(width / 2 - centerXY[0] * k, height / 2 - centerXY[1] * k)
      .scale(k);
    svg.call(zoom.transform as never, nextTransform);
  }

  function setStatus(message: string | null, showRetry = false): void {
    if (message === null) {
      statusEl.hidden = true;
      statusEl.classList.remove("is-error");
      return;
    }
    statusText.textContent = message;
    retryBtn.hidden = !showRetry;
    statusEl.hidden = false;
    statusEl.classList.toggle("is-error", showRetry);
  }

  function renderLand(layer: LandLayer, features: unknown[]): void {
    loadedLand[layer] = features;
    landGroups[layer]
      .selectAll<SVGPathElement, unknown>("path.land")
      .data(features)
      .join("path")
      .attr("class", "land")
      .attr("d", path as never)
      .attr("stroke-width", 0.5 / currentZoom);
  }

  function showLand(layer: LandLayer, immediate: boolean): void {
    const incoming = landGroups[layer];
    const outgoing = landGroups[layer === "A" ? "B" : "A"];
    if (immediate) {
      incoming.interrupt().style("opacity", 1);
      outgoing.interrupt().style("opacity", 0);
    } else {
      incoming.interrupt().transition().duration(450).style("opacity", 1);
      outgoing.interrupt().transition().duration(450).style("opacity", 0);
    }
    activeLand = layer;
    window.dispatchEvent(new CustomEvent("map:layout"));
  }

  let currentEraId: string | null = null;
  let desiredEra: Era | null = null;
  let switchChain: Promise<void> = Promise.resolve();
  let lastFailedEra: Era | null = null;

  async function performEraSwitch(era: Era): Promise<void> {
    if (desiredEra?.id !== era.id || era.id === currentEraId) return;

    try {
      const data = await loadBasemap(era.basemap);
      // A newer year superseded this request while it was downloading.
      if (desiredEra?.id !== era.id) return;

      const features = featuresFrom(data);
      const incomingLayer: LandLayer = activeLand === "A" ? "B" : "A";
      renderLand(incomingLayer, features);

      if (desiredEra?.id !== era.id) return;
      showLand(incomingLayer, currentEraId === null);
      currentEraId = era.id;
      lastFailedEra = null;
      setStatus(null);
    } catch (error) {
      console.error("[map] failed to render era", era.id, error);
      if (desiredEra?.id === era.id && currentEraId === null) {
        lastFailedEra = era;
        setStatus("地图加载失败，请检查网络后重试", true);
      }
    }
  }

  function requestEra(era: Era): Promise<void> {
    desiredEra = era;
    if (currentEraId === null && !statusEl.classList.contains("is-error")) {
      setStatus("正在加载地图…");
    }

    const request = switchChain.then(async () => {
      if (desiredEra?.id !== era.id) return;
      await performEraSwitch(era);
    });
    switchChain = request.catch(() => undefined);
    return request;
  }

  retryBtn.addEventListener("click", () => {
    if (!lastFailedEra) return;
    setStatus("正在重新加载地图…");
    void requestEra(lastFailedEra);
  });

  function renderLabels(): void {
    const year = store.get("year");
    const hoveredId = store.get("hoveredId");
    const selectedId = store.get("selectedId");
    const query = store.get("searchQuery").trim().toLowerCase();
    const schoolFilter = store.get("schoolFilter");
    const showAll = store.get("showAllPhilosophers");
    const lang = store.get("nameLang");
    const expanded = currentZoom >= LABEL_EXPAND_ZOOM;
    labelsExpanded = expanded;
    lastLabelZoomBucket = Math.max(1, Math.floor(currentZoom));

    const activeByCity = new Map<string, number>();
    const personState = new Map<
      string,
      { active: boolean; effectiveProx: number; force: boolean }
    >();

    labels().each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      const matchesQuery =
        !query ||
        d.name_zh.toLowerCase().includes(query) ||
        d.name_en.toLowerCase().includes(query) ||
        d.id.includes(query);
      const matchesSchool = !schoolFilter || d.schools.includes(schoolFilter);
      const visible = matchesQuery && matchesSchool;
      const force = visible && (d.id === hoveredId || d.id === selectedId);
      const active = visible && (force || effectiveProx >= 0.5);

      if (visible && effectiveProx >= 0.5) {
        activeByCity.set(d._cityKey, (activeByCity.get(d._cityKey) ?? 0) + 1);
      }
      personState.set(d.id, { active, effectiveProx, force });

      d3.select(this)
        .text(lang === "en" ? d.name_en : d.name_zh)
        .classed("visible", false);
    });

    clusterLabels().each(function (d) {
      const count = activeByCity.get(d.key) ?? 0;
      const hasForcedMember = d.members.some(
        (member) => personState.get(member.id)?.force,
      );
      d3.select(this)
        .text(`${lang === "en" ? d.nameEn : d.nameZh} · ${count}`)
        .classed("visible", false)
        .attr("data-count", count)
        .attr("data-forced", hasForcedMember ? "1" : "0");
    });

    const candidates: LabelCandidate[] = [];
    labels().each(function (d) {
      const state = personState.get(d.id);
      if (!state?.active) return;
      const cityCount = activeByCity.get(d._cityKey) ?? 0;
      const showAsPerson = expanded
        ? state.active
        : state.force || cityCount <= 1;
      if (!showAsPerson) return;

      candidates.push({
        kind: "person",
        element: this,
        force: state.force,
        priority: state.force
          ? 10_000
          : 100 - d.influence_tier * 10 + state.effectiveProx * 5,
      });
    });

    if (!expanded) {
      clusterLabels().each(function () {
        const count = Number(this.getAttribute("data-count") ?? 0);
        if (count < 2 || this.getAttribute("data-forced") === "1") return;
        candidates.push({
          kind: "cluster",
          element: this,
          force: false,
          priority: 250 + count,
        });
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    const maxLabels = width < 640 ? 9 : width < 1000 ? 14 : 20;
    const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const padding = 2.5 / currentZoom;
    let shown = 0;

    for (const candidate of candidates) {
      if (!candidate.force && shown >= maxLabels) break;
      const bbox = candidate.element.getBBox();
      const box = {
        left: bbox.x - padding,
        right: bbox.x + bbox.width + padding,
        top: bbox.y - padding,
        bottom: bbox.y + bbox.height + padding,
      };
      const collides = boxes.some(
        (other) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top,
      );
      if (collides && !candidate.force) continue;

      d3.select(candidate.element).classed("visible", true);
      boxes.push(box);
      shown++;
    }
  }

  function applyState(): void {
    const year = store.get("year");
    const selectedId = store.get("selectedId");
    const schoolFilter = store.get("schoolFilter");
    const showAll = store.get("showAllPhilosophers");
    const query = store.get("searchQuery").trim().toLowerCase();

    dots().each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      const matchesQuery =
        !query ||
        d.name_zh.toLowerCase().includes(query) ||
        d.name_en.toLowerCase().includes(query) ||
        d.id.includes(query);
      const matchesSchool = !schoolFilter || d.schools.includes(schoolFilter);
      const visible = matchesQuery && matchesSchool;

      d3.select(this)
        .attr("opacity", visible ? effectiveProx : 0.04)
        .classed("dim", visible ? effectiveProx < 0.2 : true)
        .classed("active", visible && effectiveProx >= 0.5)
        .classed("selected", d.id === selectedId);
    });

    hits().each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      const matchesQuery =
        !query ||
        d.name_zh.toLowerCase().includes(query) ||
        d.name_en.toLowerCase().includes(query) ||
        d.id.includes(query);
      const matchesSchool = !schoolFilter || d.schools.includes(schoolFilter);
      const interactive = matchesQuery && matchesSchool && effectiveProx >= 0.2;
      d3.select(this).style("pointer-events", interactive ? "all" : "none");
    });

    renderLabels();

    spokes().each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      const matchesSchool = !schoolFilter || d.schools.includes(schoolFilter);
      d3.select(this).style("opacity", matchesSchool ? effectiveProx * 0.5 : 0);
    });

    const era = eraForYear(year);
    if (eraNameEl && eraNameEl.textContent !== era.name_zh) {
      eraNameEl.textContent = era.name_zh;
    }
    requestEra(era);
  }

  zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 8])
    .extent([
      [0, 0],
      [width, height],
    ])
    .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
      if (event.type === "dblclick") return false;
      return !(event as MouseEvent).button;
    })
    .on("zoom", (event) => {
      const transform = event.transform;
      currentTransform = transform;
      currentZoom = transform.k;
      mainGroup.attr("transform", transform.toString());
      applyVisualScale();
      syncResetButton();
      const expanded = currentZoom >= LABEL_EXPAND_ZOOM;
      const zoomBucket = Math.max(1, Math.floor(currentZoom));
      if (
        expanded !== labelsExpanded ||
        (expanded && zoomBucket !== lastLabelZoomBucket)
      ) {
        renderLabels();
      }
      if (event.sourceEvent) {
        window.dispatchEvent(new CustomEvent("camera:user-exit"));
      }
    })
    .on("end", () => {
      renderLabels();
    });

  svg.call(zoom as never);
  resetViewBtn?.addEventListener("click", () => {
    svg
      .transition("camera")
      .duration(450)
      .ease(d3.easeCubicInOut)
      .call(zoom.transform as never, d3.zoomIdentity);
  });
  svg.on("dblclick", () => {
    svg
      .transition()
      .duration(450)
      .call(zoom.transform as never, d3.zoomIdentity);
  });
  svg.on("click", (event: MouseEvent) => {
    const target = event.target as Element;
    if (target.tagName === "circle" && target.classList.contains("philosopher")) {
      return;
    }
    store.set({ selectedId: null });
  });

  window.addEventListener("camera:target", (event) => {
    const detail = (
      event as CustomEvent<{
        lng: number;
        lat: number;
        scale: number;
        durationMs: number;
      }>
    ).detail;
    const xy = projection([detail.lng, detail.lat]);
    if (!xy) return;
    const tx = width / 2 - xy[0] * detail.scale;
    const ty = height / 2 - xy[1] * detail.scale;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(detail.scale);
    svg
      .transition("camera")
      .duration(Math.max(300, detail.durationMs))
      .ease(d3.easeCubicInOut)
      .call(zoom.transform as never, transform);
  });

  updateViewport(width, height, false);
  store.subscribe(() => applyState());
  applyState();
  await requestEra(eraForYear(store.get("year")));

  let resizeTimer: number | null = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      const next = measureRoot(rootEl);
      if (
        Math.abs(next.width - width) < 1 &&
        Math.abs(next.height - height) < 1
      ) {
        return;
      }
      updateViewport(next.width, next.height, true);
      applyState();
    }, 80);
  });
  resizeObserver.observe(rootEl);
}
