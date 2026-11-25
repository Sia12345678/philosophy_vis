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
  _regionKey: string;
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
  anchorX: number;
  anchorY: number;
  radius: number;
  key: string;
}

interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

type LabelSide = "top" | "bottom" | "left" | "right";

interface LabelPlacement {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  box: LabelBox;
  side: LabelSide;
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
  // The contemporary basemap comes from an ECharts-derived source whose
  // entries contain `geometry` and `properties` but omit the GeoJSON
  // `type: "Feature"` discriminator. d3-geo treats those as empty geometry.
  return features.map((feature) => {
    if (!feature || typeof feature !== "object") return feature;
    const candidate = feature as Record<string, unknown>;
    if (candidate.type === "Feature" || !candidate.geometry) return feature;
    return {
      type: "Feature",
      geometry: candidate.geometry,
      properties: candidate.properties ?? {},
    };
  });
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
  const leaderGroup = mainGroup
    .insert("g", ".labels-group")
    .attr("class", "label-leaders");
  const spokesGroup = mainGroup
    .insert("g", ".dots-group")
    .attr("class", "spokes-group");
  const leaderElements = new Map<string, SVGLineElement>();

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
  const measureText = labelsGroup
    .append("text")
    .attr("class", "label-measure")
    .attr("aria-hidden", "true");
  const spokes = () => spokesGroup.selectAll<SVGLineElement, Datum>("line.spoke");

  function applyVisualScale(): void {
    const k = currentZoom;
    const labelSize = width < 640 ? 11.5 : 11;
    labels()
      .style("font-size", `${labelSize / k}px`)
      .style("stroke-width", `${3 / k}`);
    clusterLabels()
      .style("font-size", `${labelSize / k}px`)
      .style("stroke-width", `${4 / k}`);
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
          _regionKey: "",
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

    // Cluster nearby cities for world-scale labels. Exact-city labels would
    // still pile up around Athens, the Levant and the Chinese plains.
    const regionThreshold = Math.max(18, Math.min(72, width * 0.048));
    const remaining = new Set(positioned);
    const regionGroups: Datum[][] = [];
    while (remaining.size > 0) {
      const seed = remaining.values().next().value as Datum;
      remaining.delete(seed);
      const group = [seed];
      for (let cursor = 0; cursor < group.length; cursor++) {
        const current = group[cursor];
        for (const other of [...remaining]) {
          if (
            Math.hypot(
              other._anchorX - current._anchorX,
              other._anchorY - current._anchorY,
            ) <= regionThreshold
          ) {
            remaining.delete(other);
            group.push(other);
          }
        }
      }
      regionGroups.push(group);
    }

    cityClusters = regionGroups.map((members) => {
      const representative = members
        .slice()
        .sort((a, b) => a.influence_tier - b.influence_tier || a.birth - b.birth)[0];
      const distinctCities = new Set(members.map((member) => member.location.zh));
      const key = members
        .map((member) => member.id)
        .sort()
        .join("|");
      for (const member of members) member._regionKey = key;
      return {
        key,
        nameZh:
          distinctCities.size > 1
            ? `${representative.location.zh}一带`
            : representative.location.zh,
        nameEn:
          distinctCities.size > 1
            ? `Around ${representative.location.en}`
            : representative.location.en,
        x: d3.mean(members, (d) => d._anchorX) ?? representative._anchorX,
        y: d3.mean(members, (d) => d._anchorY) ?? representative._anchorY,
        members,
      };
    });

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
      .attr("data-id", (d) => d.id)
      .text((d) => (store.get("nameLang") === "en" ? d.name_en : d.name_zh))
      .on("click", function (event: MouseEvent, d) {
        event.stopPropagation();
        const current = store.get("selectedId");
        store.set({ selectedId: current === d.id ? null : d.id });
      });

    const clusterJoin = labelsGroup
      .selectAll<SVGTextElement, CityCluster>("text.cluster-label")
      .data(cityClusters, (d) => d.key);
    clusterJoin.exit().remove();
    const clusterEnter = clusterJoin
      .enter()
      .append("text")
      .attr("class", "cluster-label")
      .attr("text-anchor", "middle");
    clusterEnter
      .append("tspan")
      .attr("class", "cluster-title")
      .attr("x", 0)
      .attr("dy", "0");
    clusterEnter.merge(clusterJoin).on("click", (event, d) => {
      if (currentZoom >= LABEL_EXPAND_ZOOM) return;
      event.stopPropagation();
      const lng = d3.mean(d.members, (member) => member.location.lng) ?? d.members[0].location.lng;
      const lat = d3.mean(d.members, (member) => member.location.lat) ?? d.members[0].location.lat;
      window.dispatchEvent(
        new CustomEvent("camera:target", {
          detail: {
            lng,
            lat,
            scale: Math.max(LABEL_EXPAND_ZOOM + 0.3, currentZoom * 2.4),
            durationMs: 650,
          },
        }),
      );
    });

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

  function leaderFor(key: string): d3.Selection<SVGLineElement, unknown, null, undefined> {
    let line = leaderElements.get(key);
    if (!line) {
      line = leaderGroup
        .append("line")
        .attr("class", "label-leader")
        .attr("data-key", key)
        .node() as SVGLineElement;
      leaderElements.set(key, line);
    }
    return d3.select(line);
  }

  function regionTitle(members: Datum[], lang: "zh" | "en"): string {
    const lng = d3.mean(members, (member) => member.location.lng) ?? 0;
    const lat = d3.mean(members, (member) => member.location.lat) ?? 0;
    let zh = "其他地区";
    let en = "Other";
    if (lng < -30) {
      zh = "北美";
      en = "North America";
    } else if (lng >= 95) {
      zh = "东亚";
      en = "East Asia";
    } else if (lng >= 65) {
      zh = "南亚";
      en = "South Asia";
    } else if (lng >= 38) {
      zh = "西亚";
      en = "West Asia";
    } else if (lat < 24) {
      zh = "非洲";
      en = "Africa";
    } else if (lat < 42) {
      zh = "地中海";
      en = "Mediterranean";
    } else {
      zh = "欧洲";
      en = "Europe";
    }
    return lang === "en" ? en : zh;
  }

  function labelPlacements(
    anchorX: number,
    anchorY: number,
    labelWidth: number,
    labelHeight: number,
    anchorRadius: number,
    baselineOffset: number,
  ): LabelPlacement[] {
    const gap = 6;
    const out: LabelPlacement[] = [];
    const lineY = (top: number): number => top + baselineOffset;

    const add = (
      left: number,
      top: number,
      side: LabelSide,
      anchor: LabelPlacement["anchor"],
    ): void => {
      const x = anchor === "middle" ? left + labelWidth / 2 : anchor === "end" ? left + labelWidth : left;
      out.push({
        x,
        y: lineY(top),
        anchor,
        side,
        box: {
          left,
          top,
          right: left + labelWidth,
          bottom: top + labelHeight,
          width: labelWidth,
          height: labelHeight,
        },
      });
    };

    add(anchorX - labelWidth / 2, anchorY - anchorRadius - gap - labelHeight, "top", "middle");
    add(anchorX - labelWidth / 2, anchorY + anchorRadius + gap, "bottom", "middle");
    add(anchorX + anchorRadius + gap, anchorY - labelHeight / 2, "right", "start");
    add(anchorX - anchorRadius - gap - labelWidth, anchorY - labelHeight / 2, "left", "end");

    for (let i = 1; i <= 6; i++) {
      const dy = i * (labelHeight + 3);
      add(anchorX + anchorRadius + gap, anchorY - labelHeight / 2 + dy, "right", "start");
      add(anchorX + anchorRadius + gap, anchorY - labelHeight / 2 - dy, "right", "start");
      add(anchorX - anchorRadius - gap - labelWidth, anchorY - labelHeight / 2 + dy, "left", "end");
      add(anchorX - anchorRadius - gap - labelWidth, anchorY - labelHeight / 2 - dy, "left", "end");

      const dx = i * Math.min(labelWidth + 5, 90);
      add(anchorX - labelWidth / 2 + dx, anchorY - anchorRadius - gap - labelHeight, "top", "middle");
      add(anchorX - labelWidth / 2 - dx, anchorY - anchorRadius - gap - labelHeight, "top", "middle");
      add(anchorX - labelWidth / 2 + dx, anchorY + anchorRadius + gap, "bottom", "middle");
      add(anchorX - labelWidth / 2 - dx, anchorY + anchorRadius + gap, "bottom", "middle");
    }

    const halfExtent = Math.max(labelWidth, labelHeight) / 2;
    for (let ring = 0; ring < 7; ring++) {
      const distance = anchorRadius + 12 + halfExtent + ring * 16;
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2 - Math.PI / 2;
        const centerX = anchorX + Math.cos(angle) * distance;
        const centerY = anchorY + Math.sin(angle) * distance;
        const side: LabelSide =
          Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))
            ? Math.cos(angle) >= 0
              ? "right"
              : "left"
            : Math.sin(angle) >= 0
              ? "bottom"
              : "top";
        add(centerX - labelWidth / 2, centerY - labelHeight / 2, side, "middle");
      }
    }

    return out;
  }

  function renderLabels(): void {
    const year = store.get("year");
    const hoveredId = store.get("hoveredId");
    const selectedId = store.get("selectedId");
    const spotlightId = store.get("spotlightId");
    const query = store.get("searchQuery").trim().toLowerCase();
    const schoolFilter = store.get("schoolFilter");
    const showAll = store.get("showAllPhilosophers");
    const lang = store.get("nameLang");
    const expanded = currentZoom >= LABEL_EXPAND_ZOOM;
    labelsExpanded = expanded;
    lastLabelZoomBucket = Math.max(1, Math.floor(currentZoom));

    const activeByRegion = new Map<string, number>();
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
      const force =
        visible &&
        (d.id === hoveredId || d.id === selectedId || d.id === spotlightId);
      const active = visible && (force || effectiveProx >= 0.5);

      if (visible && effectiveProx >= 0.5) {
        activeByRegion.set(d._regionKey, (activeByRegion.get(d._regionKey) ?? 0) + 1);
      }
      personState.set(d.id, { active, effectiveProx, force });

      d3.select(this)
        .text(lang === "en" ? d.name_en : d.name_zh)
        .classed("spotlight", d.id === spotlightId)
        .attr("text-anchor", "middle");
    });

    clusterLabels().each(function (d) {
      const count = activeByRegion.get(d.key) ?? 0;
      const activeMembers = d.members
        .filter((member) => personState.get(member.id)?.active)
        .sort((a, b) => a.influence_tier - b.influence_tier || a.birth - b.birth);
      const namesPerLine =
        width < 640 ? (lang === "en" ? 2 : 3) : lang === "en" ? 3 : 4;
      let names = activeMembers.map(
        (member) => (lang === "en" ? member.name_en : member.name_zh),
      );
      let omittedNames = 0;
      if (width < 360) {
        const maxNames = lang === "en" ? 2 : 9;
        if (names.length > maxNames) {
          omittedNames = names.length - maxNames;
          names = names.slice(0, maxNames);
        }
      }
      const lines: string[] = [];
      if (lang === "en") {
        const limit = width < 640 ? Math.max(220, width - 24) : Math.min(480, width * 0.36);
        const measureSize = width < 640 ? 11.5 : 11;
        const node = measureText
          .style("font-size", `${measureSize / currentZoom}px`)
          .node();
        let line = "";
        for (const name of names) {
          const next = line ? `${line} · ${name}` : name;
          measureText.text(next);
          if (
            line &&
            (node?.getComputedTextLength() ?? 0) * currentZoom > limit
          ) {
            lines.push(line);
            line = name;
          } else {
            line = next;
          }
        }
        if (line) lines.push(line);
      } else {
        for (let i = 0; i < names.length; i += namesPerLine) {
          lines.push(names.slice(i, i + namesPerLine).join(" · "));
        }
      }
      if (omittedNames > 0) {
        lines.push(
          lang === "en"
            ? `+${omittedNames} more · tap to zoom`
            : `等 ${omittedNames} 人 · 点击展开`,
        );
      }
      const text = d3.select(this).attr("text-anchor", "middle");
      text
        .select<SVGTSpanElement>("tspan.cluster-title")
        .text(`${regionTitle(activeMembers, lang)} · ${count}`);
      const memberLines = text
        .selectAll<SVGTSpanElement, string>("tspan.cluster-member-line")
        .data(lines);
      memberLines.exit().remove();
      memberLines
        .enter()
        .append("tspan")
        .attr("class", "cluster-member-line")
        .merge(memberLines)
        .attr("x", 0)
        .attr("dy", (_, i) => (i === 0 ? "1.25em" : "1.12em"))
        .text((line) => line);
      text
        .attr("data-count", count)
        .attr("data-members", d.members.map((member) => member.id).join("|"));
    });

    const candidates: LabelCandidate[] = [];
    labels().each(function (d) {
      const state = personState.get(d.id);
      if (!state?.active) return;
      const regionCount = activeByRegion.get(d._regionKey) ?? 0;
      const showAsPerson = expanded
        ? state.active
        : state.force || regionCount <= 1;
      if (!showAsPerson) return;

      candidates.push({
        kind: "person",
        element: this,
        force: state.force,
        anchorX: d._x,
        anchorY: d._y,
        radius: radiusFor(d),
        key: `p:${d.id}`,
        priority: state.force
          ? 10_000
          : 100 - d.influence_tier * 10 + state.effectiveProx * 5,
      });
    });

    if (!expanded) {
      clusterLabels().each(function (d) {
        const count = Number(this.getAttribute("data-count") ?? 0);
        if (count < 2) return;
        const activeMembers = d.members.filter(
          (member) => personState.get(member.id)?.active,
        );
        const clusterRadius = activeMembers.reduce((largest, member) => {
          const distance = Math.hypot(
            member._x - d.x,
            member._y - d.y,
          ) * currentZoom;
          return Math.max(largest, distance + radiusFor(member) + 4);
        }, 6);
        candidates.push({
          kind: "cluster",
          element: this,
          force: false,
          anchorX: d.x,
          anchorY: d.y,
          radius: clusterRadius,
          key: `c:${d.key}`,
          priority: 250 + count,
        });
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    const maxLabels = showAll
      ? width < 640
        ? 9
        : width < 1000
          ? 14
          : 20
      : Number.POSITIVE_INFINITY;
    const occupied: LabelBox[] = [];
    const svgRect = svg.node()?.getBoundingClientRect();
    const obstacles: LabelBox[] = [];
    const controlObstacles: LabelBox[] = [];

    if (svgRect) {
      for (const selector of [
        ".map-tools",
        ".map-era",
        ".map-legend",
        ".trail-panel:not([hidden])",
        "#sidebar:not(.collapsed)",
      ]) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el || el.getBoundingClientRect().width === 0) continue;
        const r = el.getBoundingClientRect();
        const box = {
          left: r.left - svgRect.left,
          top: r.top - svgRect.top,
          right: r.right - svgRect.left,
          bottom: r.bottom - svgRect.top,
          width: r.width,
          height: r.height,
        };
        obstacles.push(box);
        controlObstacles.push(box);
      }

      // Keep labels off every visible dot, not just other labels. Dense city
      // rings otherwise look like a card draped over the highlighted people.
      dots().each(function (d) {
        if (!personState.get(d.id)?.active) return;
        const x = d._x * currentZoom + currentTransform.x;
        const y = d._y * currentZoom + currentTransform.y;
        const radius = radiusFor(d) + 3;
        obstacles.push({
          left: x - radius,
          top: y - radius,
          right: x + radius,
          bottom: y + radius,
          width: radius * 2,
          height: radius * 2,
        });
      });
    }

    const leaderSize = width < 640 ? 11.5 : 11;
    const lineHeight = leaderSize * 1.28;
    let shown = 0;
    leaderGroup.selectAll("line.label-leader").attr("opacity", 0);

    const intersects = (a: LabelBox, b: LabelBox): boolean =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const pendingLabels: Array<{
      candidate: LabelCandidate;
      chosen: LabelPlacement;
      tspans: NodeListOf<SVGTSpanElement>;
      anchorX: number;
      anchorY: number;
    }> = [];

    for (const candidate of candidates) {
      if (!candidate.force && shown >= maxLabels) break;

      const anchorX = candidate.anchorX * currentZoom + currentTransform.x;
      const anchorY = candidate.anchorY * currentZoom + currentTransform.y;
      if (
        anchorX < -20 ||
        anchorX > width + 20 ||
        anchorY < -20 ||
        anchorY > height + 20
      ) {
        continue;
      }
      if (
        controlObstacles.some(
          (box) =>
            anchorX >= box.left &&
            anchorX <= box.right &&
            anchorY >= box.top &&
            anchorY <= box.bottom,
        )
      ) {
        continue;
      }

      const tspans = candidate.element.querySelectorAll<SVGTSpanElement>("tspan");
      const bbox = candidate.element.getBBox();
      let screenWidth = bbox.width * currentZoom;
      if (tspans.length > 0) {
        screenWidth = 0;
        tspans.forEach((tspan) => {
          screenWidth = Math.max(screenWidth, tspan.getComputedTextLength() * currentZoom);
        });
      }
      const screenHeight = Math.max(
        bbox.height * currentZoom,
        tspans.length > 0 ? lineHeight * tspans.length : lineHeight,
      );
      const baselineAttr = Number(candidate.element.getAttribute("y") ?? 0);
      const baselineOffset = Math.max(
        lineHeight * 0.82,
        (baselineAttr - bbox.y) * currentZoom,
      );
      const labelWidth = Math.min(width - 16, Math.max(9, screenWidth + 6));
      const labelHeight = screenHeight + 2;
      const placements = labelPlacements(
        anchorX,
        anchorY,
        labelWidth,
        labelHeight,
        candidate.radius,
        baselineOffset,
      );

      let fallback: { placement: LabelPlacement; collisions: number } | null = null;
      let chosen: LabelPlacement | null = null;

      for (const placement of placements) {
        const { box } = placement;
        const inBounds =
          box.left >= 6 &&
          box.right <= width - 6 &&
          box.top >= 6 &&
          box.bottom <= height - 6;
        if (!inBounds) continue;
        if (controlObstacles.some((other) => intersects(box, other))) continue;

        const collisions =
          obstacles.filter((other) => intersects(box, other)).length +
          occupied.filter((other) => intersects(box, other)).length;
        if (!fallback || collisions < fallback.collisions) {
          fallback = { placement, collisions };
        }
        if (collisions === 0) {
          chosen = placement;
          break;
        }
      }

      if (!chosen && candidate.force) chosen = fallback?.placement ?? null;
      // Normal timeline views must keep every visible person identifiable. If
      // there is genuinely no clean slot, prefer a readable label over hiding it.
      if (!chosen && !showAll) chosen = fallback?.placement ?? null;
      if (!chosen) continue;

      pendingLabels.push({
        candidate,
        chosen,
        tspans,
        anchorX,
        anchorY,
      });
      occupied.push(chosen.box);
      shown++;
    }

    // Measure every visible label first, then apply all placement writes once.
    // Interleaving getBBox() with attribute updates forces repeated layout.
    for (const { candidate, chosen, tspans, anchorX, anchorY } of pendingLabels) {
      const localX = (chosen.x - currentTransform.x) / currentZoom;
      const localY = (chosen.y - currentTransform.y) / currentZoom;
      d3.select(candidate.element)
        .attr("x", localX)
        .attr("y", localY)
        .attr("text-anchor", chosen.anchor)
        .classed("visible", true);
      if (tspans.length > 0) {
        tspans.forEach((tspan) => tspan.setAttribute("x", String(localX)));
      }

      const bx = chosen.box;
      const endX = Math.max(bx.left, Math.min(anchorX, bx.right));
      const endY = Math.max(bx.top, Math.min(anchorY, bx.bottom));
      const dx = endX - anchorX;
      const dy = endY - anchorY;
      const length = Math.max(1, Math.hypot(dx, dy));
      const startX = anchorX + (dx / length) * candidate.radius;
      const startY = anchorY + (dy / length) * candidate.radius;

      leaderFor(candidate.key)
        .attr("x1", (startX - currentTransform.x) / currentZoom)
        .attr("y1", (startY - currentTransform.y) / currentZoom)
        .attr("x2", (endX - currentTransform.x) / currentZoom)
        .attr("y2", (endY - currentTransform.y) / currentZoom)
        .attr("opacity", 0.62);
    }

    const shownKeys = new Set(pendingLabels.map(({ candidate }) => candidate.key));
    labels().classed("visible", (d) => shownKeys.has(`p:${d.id}`));
    clusterLabels().classed("visible", (d) => shownKeys.has(`c:${d.key}`));
  }

  function applyState(): void {
    const year = store.get("year");
    const selectedId = store.get("selectedId");
    const spotlightId = store.get("spotlightId");
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
        .classed("selected", d.id === selectedId)
        .classed("spotlight", d.id === spotlightId);
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
        inset?: { left?: number; right?: number; top?: number; bottom?: number };
      }>
    ).detail;
    const xy = projection([detail.lng, detail.lat]);
    if (!xy) return;
    const left = Math.max(0, Math.min(width - 1, detail.inset?.left ?? 0));
    const right = Math.max(0, Math.min(width - left - 1, detail.inset?.right ?? 0));
    const top = Math.max(0, Math.min(height - 1, detail.inset?.top ?? 0));
    const bottom = Math.max(
      0,
      Math.min(height - top - 1, detail.inset?.bottom ?? 0),
    );
    const targetX = left + (width - left - right) / 2;
    const targetY = top + (height - top - bottom) / 2;
    const tx = targetX - xy[0] * detail.scale;
    const ty = targetY - xy[1] * detail.scale;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(detail.scale);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    svg
      .transition("camera")
      .duration(reducedMotion ? 0 : Math.max(120, detail.durationMs))
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
