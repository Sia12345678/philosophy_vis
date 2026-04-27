import * as d3 from "d3";

import philosophersData from "../data/philosophers.json";
import type { Philosopher } from "../utils/types";
import { store } from "../utils/store";
import { lifespanProximity } from "../utils/i18n";

const philosophers = philosophersData.philosophers as Philosopher[];
const phById = new Map(philosophers.map((p) => [p.id, p]));

interface Edge {
  source: string;
  target: string;
  type: "teacher" | "influence";
}

function buildEdges(): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  // Teacher edges first so they win the dedup
  for (const p of philosophers) {
    for (const t of p.teachers) {
      const key = `${t}>${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: t, target: p.id, type: "teacher" });
    }
  }
  // Forward influence edges
  for (const p of philosophers) {
    for (const i of p.influenced) {
      const key = `${p.id}>${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: p.id, target: i, type: "influence" });
    }
  }
  // Reverse influenced_by — only add if the forward edge wasn't already declared
  for (const p of philosophers) {
    for (const b of p.influenced_by) {
      const key = `${b}>${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: b, target: p.id, type: "influence" });
    }
  }
  return edges.filter((e) => phById.has(e.source) && phById.has(e.target));
}

function getDotPos(id: string): [number, number] | null {
  const el = document.querySelector(
    `circle.philosopher[data-id="${id}"]`,
  ) as SVGCircleElement | null;
  if (!el) return null;
  return [+el.getAttribute("cx")!, +el.getAttribute("cy")!];
}

function curvePath(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    // self-loop (e.g. teacher in same group) — draw a tiny arc
    return `M${ax - 5},${ay} A 5 5 0 1 1 ${ax + 5} ${ay}`;
  }
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const offset = Math.min(36, len * 0.18);
  const cx = mx + (-dy / len) * offset;
  const cy = my + (dx / len) * offset;
  return `M${ax},${ay} Q${cx},${cy} ${bx},${by}`;
}

export function initLineage(): void {
  const lineageGroup = document.querySelector(
    "g.lineage-group",
  ) as SVGGElement | null;
  if (!lineageGroup) {
    console.warn("[lineage] no g.lineage-group found");
    return;
  }

  const edges = buildEdges();

  const paths = d3
    .select(lineageGroup)
    .selectAll<SVGPathElement, Edge>("path.lineage")
    .data(edges, (d) => `${d.source}>${d.target}`)
    .enter()
    .append("path")
    .attr("class", (d) => `lineage lineage-${d.type}`)
    .attr("data-source", (d) => d.source)
    .attr("data-target", (d) => d.target)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("d", (d) => {
      const a = getDotPos(d.source);
      const b = getDotPos(d.target);
      if (!a || !b) return "";
      return curvePath(a, b);
    })
    .style("opacity", 0);

  function applyState(): void {
    const showAll = store.get("showLineage");
    const selectedId = store.get("selectedId");
    const year = store.get("year");
    const query = store.get("searchQuery").trim().toLowerCase();
    const schoolFilter = store.get("schoolFilter");
    const showAllPhilosophers =
      store.get("showAllPhilosophers") && !store.get("isPlaying");

    function isVisible(p: Philosopher): boolean {
      const matchesQuery =
        !query ||
        p.name_zh.toLowerCase().includes(query) ||
        p.name_en.toLowerCase().includes(query) ||
        p.id.includes(query);
      const matchesSchool = !schoolFilter || p.schools.includes(schoolFilter);
      if (!matchesQuery || !matchesSchool) return false;
      if (showAllPhilosophers) return true;
      return lifespanProximity(p, year) >= 0.5;
    }

    paths.each(function (d) {
      const sourceP = phById.get(d.source);
      const targetP = phById.get(d.target);
      if (!sourceP || !targetP) {
        d3.select(this).style("opacity", 0);
        return;
      }

      const isFocused =
        selectedId !== null &&
        (d.source === selectedId || d.target === selectedId);

      let opacity = 0;
      if (isFocused) {
        opacity = 0.9;
      } else if (showAll && isVisible(sourceP) && isVisible(targetP)) {
        opacity = 0.45;
        if (selectedId !== null) opacity *= 0.4;
      }

      d3.select(this)
        .style("opacity", opacity)
        .classed("focused", isFocused)
        .classed("dim", showAll && !isFocused);

      if (isFocused) d3.select(this).raise();
    });
  }

  store.subscribe(() => applyState());
  applyState();
}
