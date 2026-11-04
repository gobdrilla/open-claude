<script lang="ts" module>
  import type { DiffFile, Hunk } from "$lib/diff";

  /** Aktion pro Hunk; lineLabel gilt, sobald Zeilen im Hunk gewaehlt sind. */
  export type HunkAction = {
    label: string;
    lineLabel?: string;
    destructive?: boolean;
    run: (file: DiffFile, hunk: Hunk, selected: Set<number>) => void;
  };
</script>

<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { parseDiff } from "$lib/diff";
  import { Button, IconButton, PromptDialog, TextButton, fileIcon } from "$lib/atelier-ui";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import { review } from "$lib/review.svelte";
  import { dirname } from "$lib/tree";

  let {
    diff,
    actions = [],
    empty = "Keine Änderungen.",
    busy = false,
    repo,
    rev,
    onopen,
  }: {
    diff: string;
    actions?: HunkAction[];
    empty?: string;
    busy?: boolean;
    repo?: string;
    rev?: string;
    /** Open the file in the editor (header button, double-click on a line jumps to it). */
    onopen?: (path: string, line?: number) => void;
  } = $props();

  // Line in the new version; a deleted line maps to the nearest line above it.
  const newLine = (hunk: Hunk, li: number) => hunk.lines.slice(0, li + 1).findLast((l) => l.new)?.new ?? Math.max(1, hunk.newStart);

  const files = $derived(parseDiff(diff));

  // Gewaehlte Zeilen je Hunk ("datei:hunk" -> Indizes in hunk.lines), Anker fuer Shift-Klick.
  let selected = $state<Record<string, number[]>>({});
  let anchor = $state<{ key: string; idx: number } | null>(null);

  // Grosse Dateien (Lockfiles, generierter Code) erst auf Wunsch rendern.
  const BIG = 1500;
  const opened = new SvelteSet<number>();
  const size = (f: DiffFile) => f.hunks.reduce((n, h) => n + h.lines.length, 0);
  const count = (f: DiffFile, kind: "add" | "del") => f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === kind).length, 0);

  // Mit repo: gewaehlte Zeilen kommentieren (review.svelte.ts), Schluessel "datei:zeile" der ersten Zeile.
  const pickable = $derived(actions.length > 0 || !!repo);
  // shortcut: "-5" und "+5" teilen sich datei:5, reicht fuers Review
  // Commit-Diff (rev): "sha:datei:zeile" wie git show sha:datei, damit Claude es nicht fuer die Arbeitskopie haelt
  const noteKey = (file: DiffFile, l: { old?: number; new?: number }) =>
    `${rev ? rev.slice(0, 7) + ":" : ""}${file.newPath}:${l.new ?? l.old}`;
  let note = $state<{ key: string; hunkKey: string; lines: string[] } | null>(null);
  let noteText = $state("");

  function comment(file: DiffFile, hunk: Hunk, hunkKey: string, sel: Set<number>) {
    const idx = [...sel].sort((a, b) => a - b);
    const key = noteKey(file, hunk.lines[idx[0]]);
    note = { key, hunkKey, lines: idx.map((i) => sign[hunk.lines[i].kind] + hunk.lines[i].text) };
    noteText = review[repo!]?.[key]?.text ?? "";
  }

  function saveNote() {
    if (!note || !repo) return;
    const notes = (review[repo] ??= {});
    // Leerer Text loescht den Kommentar
    if (noteText.trim()) notes[note.key] = { text: noteText.trim(), lines: note.lines };
    else delete notes[note.key];
    selected[note.hunkKey] = [];
    note = null;
  }

  $effect(() => {
    diff;
    selected = {};
    anchor = null;
    opened.clear();
  });

  function pick(key: string, hunk: Hunk, idx: number, shift: boolean) {
    const cur = new Set(selected[key] ?? []);
    if (shift && anchor?.key === key) {
      const [a, b] = [Math.min(anchor.idx, idx), Math.max(anchor.idx, idx)];
      for (let i = a; i <= b; i++) if (hunk.lines[i].kind === "add" || hunk.lines[i].kind === "del") cur.add(i);
    } else {
      cur.has(idx) ? cur.delete(idx) : cur.add(idx);
      anchor = { key, idx };
    }
    selected[key] = [...cur];
  }

  const bg = {
    add: "bg-success/10 border-success",
    del: "bg-destructive/10 border-destructive",
    ctx: "border-transparent",
    meta: "text-muted-foreground italic border-transparent",
  };
  const sign = { add: "+", del: "-", ctx: " ", meta: "" };
</script>

<div class="h-full overflow-x-hidden overflow-y-auto font-mono text-meta leading-[1.45]">
  {#if files.length === 0}
    <p class="text-muted-foreground p-3 font-sans text-ui">{empty}</p>
  {/if}
  {#each files as file, fi (fi)}
    {@const fic = fileIcon(file.newPath)}
    {@const dir = dirname(file.newPath)}
    <!-- Karte so breit wie der Platz: Kopf und Hunk-Leiste bleiben stehen, nur die Zeilen scrollen waagerecht -->
    <!-- Abstand per Margin statt Container-Padding, sonst scrollt der Inhalt ueber dem sticky Kopf durch -->
    <div class="bg-background/40 ring-foreground/5 mx-2 mt-2 min-w-0 rounded-xl ring-1 last:mb-2">
      <div class="bg-card/95 border-border/60 sticky top-0 z-10 flex items-center gap-2 rounded-t-xl border-b px-2.5 py-1.5 font-sans backdrop-blur">
        <fic.icon class="size-3.5 shrink-0 {fic.tint}" />
        <span class="min-w-0 truncate font-semibold">{file.newPath.slice(dir ? dir.length + 1 : 0)}</span>
        <span class="text-muted-foreground min-w-0 flex-1 truncate text-meta"
          >{file.oldPath !== file.newPath ? `${file.oldPath} →` : dir}</span
        >
        {#if onopen && file.status !== "deleted"}
          <IconButton
            size="md"
            label="Im Editor öffnen"
            title="Im Editor öffnen (Doppelklick auf eine Zeile springt dorthin)"
            onclick={() => onopen(file.newPath, file.hunks[0] && newLine(file.hunks[0], 0))}><FileCodeIcon class="size-3.5" /></IconButton
          >
        {/if}
        {#if !file.binary}
          <span class="bg-success/15 text-success shrink-0 rounded-full px-1.5 font-mono text-[10px]">+{count(file, "add")}</span>
          <span class="bg-destructive/15 text-destructive shrink-0 rounded-full px-1.5 font-mono text-[10px]">−{count(file, "del")}</span>
        {/if}
      </div>
      {#if file.binary}
        <p class="text-muted-foreground px-2 py-1 font-sans">Binärdatei</p>
      {:else if file.hunks.length === 0}
        <p class="text-muted-foreground px-2 py-1 font-sans">Keine Inhaltsänderung.</p>
      {:else if size(file) > BIG && !opened.has(fi)}
        <TextButton class="px-2 py-1 font-sans" onclick={() => opened.add(fi)}>
          {size(file)} Zeilen – anzeigen
        </TextButton>
      {/if}
      {#each size(file) > BIG && !opened.has(fi) ? [] : file.hunks as hunk, hi (hi)}
        {@const key = `${fi}:${hi}`}
        {@const sel = new Set(selected[key] ?? [])}
        <div class="bg-primary/5 text-primary/70 border-primary/10 flex items-center gap-1 border-y px-2.5 py-0.5">
          <span class="min-w-0 flex-1 truncate">{hunk.header}</span>
          {#if repo && sel.size}
            <Button variant="ghost" size="2xs" class="font-sans" onclick={() => comment(file, hunk, key, sel)}>
              Kommentieren
            </Button>
          {/if}
          {#each actions as a (a.label)}
            <!-- detail: the second click of a double click would hit the next hunk's button once the diff reloaded. -->
            <Button
              variant={a.destructive ? "destructive" : "ghost"}
              size="2xs"
              class="font-sans"
              disabled={busy}
              onclick={(e) => e.detail < 2 && a.run(file, hunk, sel)}
            >
              {sel.size && a.lineLabel ? a.lineLabel : a.label}
            </Button>
          {/each}
        </div>
        <div class="overflow-x-auto"><div class="w-max min-w-full">
        {#each hunk.lines as line, li (li)}
          {@const change = line.kind === "add" || line.kind === "del"}
          {@const noted = repo && change ? review[repo]?.[noteKey(file, line)] : undefined}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="flex border-l-2 {bg[line.kind]} {sel.has(li) ? 'ring-primary/60 ring-1 ring-inset' : ''} {change &&
            pickable
              ? 'cursor-pointer'
              : ''} {noted ? 'outline-warning outline-1 -outline-offset-1 outline-dashed' : ''}"
            title={noted?.text}
            onclick={(e) => change && pickable && pick(key, hunk, li, e.shiftKey)}
            ondblclick={onopen && file.status !== "deleted" ? () => onopen(file.newPath, newLine(hunk, li)) : undefined}
          >
            <span class="text-muted-foreground/60 w-10 shrink-0 pr-1 text-right select-none">{line.old ?? ""}</span>
            <span class="text-muted-foreground/60 w-10 shrink-0 pr-1 text-right select-none">{line.new ?? ""}</span>
            <span
              class="w-4 shrink-0 text-center select-none {line.kind === 'add'
                ? 'text-success'
                : line.kind === 'del'
                  ? 'text-destructive'
                  : ''}">{sign[line.kind]}</span
            >
            <span class="pr-2 whitespace-pre">{line.text}</span>
          </div>
        {/each}
        </div></div>
      {/each}
    </div>
  {/each}
</div>

<PromptDialog
  open={note !== null}
  title="Kommentar für Claude"
  description={note?.key}
  bind:value={noteText}
  placeholder="Was soll Claude hier ändern?"
  action="Speichern"
  onsubmit={saveNote}
  oncancel={() => (note = null)}
/>
