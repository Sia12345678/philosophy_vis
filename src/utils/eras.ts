import erasData from "../data/eras.json";
import type { Era } from "./types";

const eras = erasData.eras as Era[];

export function getAllEras(): Era[] {
  return eras;
}

export function eraForYear(year: number): Era {
  for (const e of eras) {
    if (year >= e.from && year < e.to) return e;
  }
  return year < eras[0].from ? eras[0] : eras[eras.length - 1];
}

const cache = new Map<string, Promise<unknown>>();

export function loadBasemap(filename: string): Promise<unknown> {
  if (!cache.has(filename)) {
    cache.set(
      filename,
      fetch(`./basemaps/${filename}`).then((r) => {
        if (!r.ok) throw new Error(`failed to load ${filename}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(filename)!;
}
