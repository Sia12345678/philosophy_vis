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
const MAX_ATTEMPTS = 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchBasemap(filename: string): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`./basemaps/${filename}`);
      if (!response.ok) {
        throw new Error(`failed to load ${filename}: ${response.status}`);
      }
      const data = (await response.json()) as { features?: unknown };
      if (!Array.isArray(data.features) || data.features.length === 0) {
        throw new Error(`basemap ${filename} contains no features`);
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await wait(250 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`failed to load ${filename}`);
}

export function loadBasemap(filename: string): Promise<unknown> {
  if (!cache.has(filename)) {
    const request = fetchBasemap(filename).catch((error: unknown) => {
      // Do not memoize failures: a transient network error must be retryable.
      cache.delete(filename);
      throw error;
    });
    cache.set(filename, request);
  }
  return cache.get(filename)!;
}
