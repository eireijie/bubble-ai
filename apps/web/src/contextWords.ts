/** Plain-words headline for how full an agent's context window is (percent, 0-100). */
export function contextWords(pct: number | null): string {
  if (pct === null) return "Nothing used yet";
  if (pct < 10) return "Nearly empty";
  if (pct < 25) return "Under a quarter full";
  if (pct < 40) return "Roughly a third full";
  if (pct < 60) return "Roughly half full";
  if (pct < 75) return "Over half full";
  if (pct < 90) return "Getting full";
  return "Nearly full";
}
