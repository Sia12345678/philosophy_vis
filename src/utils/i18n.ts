export function formatYear(year: number): string {
  if (year < 0) return `公元前 ${Math.abs(year)}`;
  if (year === 0) return "公元元年";
  return `公元 ${year}`;
}

export function formatLifespan(birth: number, death: number): string {
  const fmt = (y: number) => (y < 0 ? `前${Math.abs(y)}` : `${y}`);
  return `${fmt(birth)} – ${fmt(death)}`;
}

export function isAlive(p: { birth: number; death: number }, year: number): boolean {
  return year >= p.birth && year <= p.death;
}

export function lifespanProximity(
  p: { birth: number; death: number },
  year: number,
): number {
  if (isAlive(p, year)) return 1;
  const dist = year < p.birth ? p.birth - year : year - p.death;
  if (dist > 80) return 0;
  return Math.max(0, 1 - dist / 80);
}
