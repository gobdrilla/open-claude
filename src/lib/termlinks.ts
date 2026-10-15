/** Dateipfad in einer Terminalzeile: Spalten ab 0 (start inklusiv, end exklusiv), line/col ab 1. */
export type PathHit = { start: number; end: number; path: string; line?: number; col?: number };

// Mit Endung, sonst waere jedes Wort mit / ein Treffer; optional :zeile(:spalte). Klammern, Quotes und
// Satzzeichen gehoeren nicht dazu ("Read(src/a.ts)", "`a.ts`."). Ob es die Datei gibt, prueft der Aufrufer.
// Nur am Wortanfang (Lookbehind), sonst traefe "s://x.dev/a.md" mitten in einer URL.
const PATH = /(?<![\w.~@+/\\:-])(?:[A-Za-z]:)?[\w.~@+/\\-]*[\w-]\.[A-Za-z]\w{0,9}(?::(\d+))?(?::(\d+))?/g;

// Zeile, die nur aus einem absoluten Pfad besteht (claude setzt Pfade gern so ab): darf Leerzeichen enthalten.
const WHOLE = /^(\s*)((?:~|[A-Za-z]:)?[\\/]\S.*?\.[A-Za-z]\w{0,9})(?::(\d+))?(?::(\d+))?\s*$/;

const DRIVE = /(?<![\w.~@+/\\:-])[A-Za-z]:[\\/]/g;

const hit = (start: number, end: number, path: string, line?: string, col?: string): PathHit => ({
  start,
  end,
  path,
  line: line ? Number(line) : undefined,
  col: col ? Number(col) : undefined,
});

/** Kandidaten, auch ueberlappende ("/a b.iso" ganz und "/a" allein); `keep` waehlt nach der Existenzpruefung. */
export function pathHits(text: string): PathHit[] {
  const out = [...text.matchAll(PATH)].map((m) => {
    const [all, line, col] = m;
    const path = all.slice(0, all.length - (line ? line.length + 1 : 0) - (col ? col.length + 1 : 0));
    return hit(m.index, m.index + all.length, path, line, col);
  });
  // Windows-Pfad mit Leerzeichen mitten im Satz ("in C:\Users\Max Muster\a.ts:3"): vom Laufwerk bis zu jedem
  // spaeteren Treffer ein Kandidat; keep nimmt nach der Existenzpruefung den laengsten.
  for (const d of text.matchAll(DRIVE))
    for (const h of out.slice()) {
      const gap = text.slice(d.index, h.start);
      if (h.start > d.index && gap.length <= 260 && gap.includes(" ") && !/[()"'`<>|*?\t:]/.test(gap.slice(2)))
        out.push({ ...h, start: d.index, path: gap + h.path });
    }
  const w = text.match(WHOLE);
  if (w?.[2].includes(" ")) out.unshift(hit(w[1].length, w[0].trimEnd().length, w[2], w[3], w[4]));
  return out;
}

/** Existierende Treffer ohne Ueberlappung, laengere zuerst. */
export function keep<T extends PathHit>(hits: T[]): T[] {
  const out: T[] = [];
  for (const h of [...hits].sort((a, b) => b.end - b.start - (a.end - a.start)))
    if (out.every((o) => h.end <= o.start || h.start >= o.end)) out.push(h);
  return out.sort((a, b) => a.start - b.start);
}
