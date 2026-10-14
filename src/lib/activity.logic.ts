// Agent-Zeitleiste: aufeinanderfolgende Tool-Aufrufe werden eine Gruppe, damit Text und Auftrag nicht darin untergehen.
export type Chunk<E> = { e: E; tools?: undefined } | { tools: E[] };

export function chunks<E extends { kind: string }>(log: E[]): Chunk<E>[] {
  const out: Chunk<E>[] = [];
  for (const e of log) {
    const prev = out.at(-1);
    if (e.kind !== "tool") out.push({ e });
    else if (prev?.tools) prev.tools.push(e);
    else out.push({ tools: [e] });
  }
  return out;
}

/** "Read ×3, Bash ×2": häufigste zuerst, MCP-Präfix weg. */
export function tally(es: { tool: string }[]): string {
  const n = new Map<string, number>();
  for (const { tool } of es) {
    const t = tool.replace(/^mcp__.*?__/, "");
    n.set(t, (n.get(t) ?? 0) + 1);
  }
  return [...n]
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => (c > 1 ? `${t} ×${c}` : t))
    .join(", ");
}
