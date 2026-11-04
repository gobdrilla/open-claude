export type Count = { index: number; total: number; more: boolean };

/**
 * Count matches up to cap; index = 1-based position of the match equal to the selection, 0 = none selected
 * (-1, set by the caller: a selected match past the cap).
 */
export function countMatches(it: Iterator<{ from: number; to: number }>, sel: { from: number; to: number }, cap = 1000): Count {
  let total = 0;
  let index = 0;
  for (let n = it.next(); !n.done; n = it.next()) {
    if (total === cap) return { index, total, more: true };
    total++;
    if (n.value.from === sel.from && n.value.to === sel.to) index = total;
  }
  return { index, total, more: false };
}

/** "3 von 12", "12 Treffer" while no match is selected, "1000+" past the cap, "? von 1000+" for a match past it. */
export function countLabel({ index, total, more }: Count): string {
  if (!total) return "Keine Treffer";
  const n = `${total}${more ? "+" : ""}`;
  return index ? `${index < 0 ? "?" : index} von ${n}` : `${n} Treffer`;
}
