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

type Datum = Philosopher & { _x: number; _y: number; _anchorX: number; _anchorY: number };

export async function initMap(rootEl: HTMLElement): Promise<void> {
  const { clientWidth: w, clientHeight: h } = rootEl;
  const width = Math.max(w, 600);
  const height = Math.max(h, 400);

  const svg = d3
    .select(rootEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // Ocean stays static (background, no zoom)
  svg
    .append("rect")
    .attr("class", "ocean")
    .attr("width", width)
    .attr("height", height);

  const projection = d3
    .geoNaturalEarth1()
    .scale(width / 6.2)
    .translate([width / 2, height / 1.85]);

  const path = d3.geoPath(projection);

  // Everything below ocean transforms with zoom
  const mainGroup = svg.append("g").attr("class", "main-group");

  // Graticule
  const graticule = d3.geoGraticule().step([20, 20]);
  mainGroup
    .append("path")
    .attr("class", "graticule")
    .datum(graticule())
    .attr("d", path);

  // Two land layers for cross-fade between historical eras
  const landWrap = mainGroup.append("g").attr("class", "land-wrap");
  const landA = landWrap.append("g").attr("class", "land-group land-a").style("opacity", 0);
  const landB = landWrap.append("g").attr("class", "land-group land-b").style("opacity", 0);
  let activeIs: "A" | "B" = "A";
  let currentEraId: string | null = null;
  let switchInFlight: Promise<void> | null = null;
  let currentZoom = 1;

  async function renderLand(target: d3.Selection<SVGGElement, unknown, null, undefined>, era: Era): Promise<void> {
    try {
      const data = (await loadBasemap(era.basemap)) as any;
      const features = data?.features ?? [];
      const sel = target
        .selectAll<SVGPathElement, unknown>("path.land")
        .data(features, (_d: any, i: number) => i);
      sel.enter()
        .append("path")
        .attr("class", "land")
        .attr("d", path as any)
        .merge(sel as any)
        .attr("d", path as any);
      sel.exit().remove();
    } catch (err) {
      console.error("[map] failed to render era", era.id, err);
    }
  }

  async function switchToEra(era: Era): Promise<void> {
    if (era.id === currentEraId) return;
    if (switchInFlight) await switchInFlight;
    currentEraId = era.id;
    const incoming = activeIs === "A" ? landB : landA;
    const outgoing = activeIs === "A" ? landA : landB;
    const k = currentZoom;
    incoming.selectAll<SVGPathElement, unknown>("path.land").attr("stroke-width", 0.5 / k);
    switchInFlight = renderLand(incoming, era).then(() => {
      incoming.selectAll<SVGPathElement, unknown>("path.land").attr("stroke-width", 0.5 / k);
      incoming.transition().duration(450).style("opacity", 1);
      outgoing.transition().duration(450).style("opacity", 0);
      activeIs = activeIs === "A" ? "B" : "A";
      switchInFlight = null;
    });
    await switchInFlight;
  }

  // Reserved layer for Phase 3 lineage edges (between land and dots)
  mainGroup.append("g").attr("class", "lineage-group");

  // Anchor markers (small × at each true geographic city center)
  const anchorsGroup = mainGroup.append("g").attr("class", "anchors-group");

  // Philosopher dots
  const dotsGroup = mainGroup.append("g").attr("class", "dots-group");
  const labelsGroup = mainGroup.append("g").attr("class", "labels-group");

  // Compute initial xy for each philosopher
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
      } as Datum;
    })
    .filter((p): p is Datum => p !== null);

  // Clock-face layout for co-located dots
  // Cell key by rounded coords; group philosophers per cell; arrange in concentric rings.
  const cellSize = 6;
  const groups = new Map<string, Datum[]>();
  for (const p of positioned) {
    const key = `${Math.round(p._anchorX / cellSize)}_${Math.round(p._anchorY / cellSize)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const cityAnchors: Array<{ x: number; y: number }> = [];
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    // Sort by birth year so the clock is chronological (top = oldest)
    group.sort((a, b) => a.birth - b.birth);
    cityAnchors.push({ x: group[0]._anchorX, y: group[0]._anchorY });

    const baseRadius = 11;
    const ringStep = 9;
    const ringCapacity = 8;

    let i = 0;
    while (i < group.length) {
      const ringIdx = Math.floor(i / ringCapacity);
      const inThisRing = Math.min(ringCapacity, group.length - ringIdx * ringCapacity);
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

  // Render anchors (faint × at each multi-philosopher city)
  anchorsGroup
    .selectAll<SVGGElement, { x: number; y: number }>("g.anchor")
    .data(cityAnchors)
    .enter()
    .append("g")
    .attr("class", "anchor")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .each(function () {
      const g = d3.select(this);
      g.append("circle").attr("r", 1.5).attr("class", "anchor-dot");
    });

  const dots = dotsGroup
    .selectAll<SVGCircleElement, Datum>("circle.philosopher")
    .data(positioned, (d) => d.id)
    .enter()
    .append("circle")
    .attr("class", "philosopher")
    .attr("data-id", (d) => d.id)
    .attr("cx", (d) => d._x)
    .attr("cy", (d) => d._y)
    .attr("r", radiusFor)
    .attr("fill", colorFor)
    .attr("stroke", "#1f1a14")
    .attr("stroke-width", 0.6)
    .attr("opacity", 0);

  const labels = labelsGroup
    .selectAll<SVGTextElement, Datum>("text.philosopher-label")
    .data(positioned, (d) => d.id)
    .enter()
    .append("text")
    .attr("class", "philosopher-label")
    .attr("x", (d) => d._x)
    .attr("y", (d) => d._y - radiusFor(d) - 3)
    .attr("text-anchor", "middle")
    .text((d) => (store.get("nameLang") === "en" ? d.name_en : d.name_zh));

  // Connecting hairlines from each clock-positioned dot to its city anchor
  // (only for dots that were displaced by the clock layout)
  const spokes = mainGroup
    .insert("g", ".dots-group")
    .attr("class", "spokes-group")
    .selectAll<SVGLineElement, Datum>("line.spoke")
    .data(positioned.filter((d) => d._x !== d._anchorX || d._y !== d._anchorY), (d) => d.id)
    .enter()
    .append("line")
    .attr("class", "spoke")
    .attr("x1", (d) => d._anchorX)
    .attr("y1", (d) => d._anchorY)
    .attr("x2", (d) => d._x)
    .attr("y2", (d) => d._y);

  // Hover & click handlers
  dots
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
      const cur = store.get("selectedId");
      store.set({ selectedId: cur === d.id ? null : d.id });
    });

  // Zoom behavior — D3 zoom on SVG, transform on mainGroup
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 8])
    .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
      // Allow wheel + drag, but skip dblclick (we override below)
      if (event.type === "dblclick") return false;
      return !(event as MouseEvent).button;
    })
    .on("zoom", (event) => {
      const t = event.transform;
      mainGroup.attr("transform", t.toString());
      const k = t.k;
      currentZoom = k;
      // Counter-scale visual elements that should keep constant pixel size
      labels.style("font-size", `${11 / k}px`).style("stroke-width", `${3 / k}`);
      dots.attr("r", (d) => radiusFor(d) / k).attr("stroke-width", 0.6 / k);
      spokes.style("stroke-width", `${0.5 / k}`);
      anchorsGroup.selectAll<SVGCircleElement, unknown>("circle.anchor-dot").attr("r", 1.5 / k);
      svg.select(".graticule").attr("stroke-width", 0.3 / k);
      landWrap.selectAll<SVGPathElement, unknown>("path.land").attr("stroke-width", 0.5 / k);
      // Update label offset since dot radius changed
      labels.attr("y", (d) => d._y - radiusFor(d) / k - 3 / k);
      // User-initiated zoom → exit cinematic mode in timeline
      if (event.sourceEvent) {
        window.dispatchEvent(new CustomEvent("camera:user-exit"));
      }
    });

  svg.call(zoom as any);

  // Cinematic camera target listener
  window.addEventListener("camera:target", (e) => {
    const detail = (e as CustomEvent<{ lng: number; lat: number; scale: number; durationMs: number }>).detail;
    const xy = projection([detail.lng, detail.lat]);
    if (!xy) return;
    const tx = width / 2 - xy[0] * detail.scale;
    const ty = height / 2 - xy[1] * detail.scale;
    const T = d3.zoomIdentity.translate(tx, ty).scale(detail.scale);
    svg
      .transition("camera")
      .duration(Math.max(300, detail.durationMs))
      .ease(d3.easeCubicInOut)
      .call(zoom.transform as any, T);
  });

  // Double-click resets zoom (and exits cinematic via the user-exit dispatch above)
  svg.on("dblclick", () => {
    svg.transition().duration(450).call(zoom.transform as any, d3.zoomIdentity);
  });

  // Click on empty area clears selection
  svg.on("click", (event: MouseEvent) => {
    const target = event.target as Element;
    if (target.tagName === "circle" && target.classList.contains("philosopher")) return;
    store.set({ selectedId: null });
  });

  function applyState(): void {
    const year = store.get("year");
    const hoveredId = store.get("hoveredId");
    const selectedId = store.get("selectedId");
    const query = store.get("searchQuery").trim().toLowerCase();
    const schoolFilter = store.get("schoolFilter");
    const showAll =
      store.get("showAllPhilosophers") && !store.get("isPlaying");

    dots.each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      const matchesQuery =
        !query ||
        d.name_zh.toLowerCase().includes(query) ||
        d.name_en.toLowerCase().includes(query) ||
        d.id.includes(query);
      const matchesSchool = !schoolFilter || d.schools.includes(schoolFilter);
      const visible = matchesQuery && matchesSchool;

      const sel = d3.select(this);
      sel
        .attr("opacity", visible ? effectiveProx : 0.04)
        .classed("dim", visible ? effectiveProx < 0.2 : true)
        .classed("active", visible && effectiveProx >= 0.5)
        .classed("selected", d.id === selectedId);
    });

    const lang = store.get("nameLang");
    labels.each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      const isHovered = d.id === hoveredId;
      const isSelected = d.id === selectedId;
      const showLabel = isHovered || isSelected || effectiveProx >= 0.5;
      const sel = d3.select(this);
      sel.classed("visible", showLabel);
      const want = lang === "en" ? d.name_en : d.name_zh;
      if (sel.text() !== want) sel.text(want);
    });

    spokes.each(function (d) {
      const prox = lifespanProximity(d, year);
      const effectiveProx = showAll ? 1 : prox;
      d3.select(this).style("opacity", effectiveProx * 0.5);
    });

    // Era switching
    const era = eraForYear(year);
    if (era.id !== currentEraId) {
      void switchToEra(era);
    }
  }

  store.subscribe(() => applyState());

  // Initial era load — block on first paint so we never show empty land
  await switchToEra(eraForYear(store.get("year")));
  applyState();

  const ro = new ResizeObserver(() => {
    /* keep viewBox; CSS handles fit */
  });
  ro.observe(rootEl);
}
