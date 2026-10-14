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
  import { Button } from "$lib/components/ui/button/index.js";
  import { fileIcon } from "$lib/components/kit";
  import { dirname } from "$lib/tree";

  let {
    diff,
    actions = [],
    empty = "Keine Änderungen.",
    busy = false,
  }: { diff: string; actions?: HunkAction[]; empty?: string; busy?: boolean } = $props();

  const files = $derived(parseDiff(diff));

  // Gewaehlte Zeilen je Hunk ("datei:hunk" -> Indizes in hunk.lines), Anker fuer Shift-Klick.
  let selected = $state<Record<string, number[]>>({});
  let anchor = $state<{ key: string; idx: number } | null>(null);

  // Grosse Dateien (Lockfiles, generierter Code) erst auf Wunsch rendern.
  const BIG = 1500;
  const opened = new SvelteSet<number>();
  const size = (f: DiffFile) => f.hunks.reduce((n, h) => n + h.lines.length, 0);
  const count = (f: DiffFile, kind: "add" | "del") => f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === kind).length, 0);

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

<div class="h-full overflow-auto font-mono text-[11px] leading-[1.45]">
  {#if files.length === 0}
    <p class="text-muted-foreground p-3 font-sans text-xs">{empty}</p>
  {/if}
  {#each files as file, fi (fi)}
    {@const fic = fileIcon(file.newPath)}
    {@const dir = dirname(file.newPath)}
    <!-- w-max: lange Zeilen verbreitern die Karte, gescrollt wird aussen -->
    <!-- Abstand per Margin statt Container-Padding, sonst scrollt der Inhalt ueber dem sticky Kopf durch -->
    <div class="bg-background/40 ring-foreground/5 mx-2 mt-2 w-max min-w-[calc(100%-1rem)] rounded-xl ring-1 last:mb-2">
      <div class="bg-card/95 border-border/60 sticky top-0 z-10 flex items-center gap-2 rounded-t-xl border-b px-2.5 py-1.5 font-sans backdrop-blur">
        <fic.icon class="size-3.5 shrink-0 {fic.tint}" />
        <span class="font-semibold">{file.newPath.slice(dir ? dir.length + 1 : 0)}</span>
        <span class="text-muted-foreground text-[10px]"
          >{file.oldPath !== file.newPath ? `${file.oldPath} →` : dir}</span
        >
        <span class="flex-1"></span>
        {#if !file.binary}
          <span class="bg-success/15 text-success rounded-full px-1.5 font-mono text-[10px]">+{count(file, "add")}</span>
          <span class="bg-destructive/15 text-destructive rounded-full px-1.5 font-mono text-[10px]">−{count(file, "del")}</span>
        {/if}
      </div>
      {#if file.binary}
        <p class="text-muted-foreground px-2 py-1 font-sans">Binärdatei</p>
      {:else if file.hunks.length === 0}
        <p class="text-muted-foreground px-2 py-1 font-sans">Keine Inhaltsänderung.</p>
      {:else if size(file) > BIG && !opened.has(fi)}
        <button class="text-muted-foreground hover:text-foreground px-2 py-1 font-sans" onclick={() => opened.add(fi)}>
          {size(file)} Zeilen – anzeigen
        </button>
      {/if}
      {#each size(file) > BIG && !opened.has(fi) ? [] : file.hunks as hunk, hi (hi)}
        {@const key = `${fi}:${hi}`}
        {@const sel = new Set(selected[key] ?? [])}
        <div class="bg-primary/5 text-primary/70 border-primary/10 flex items-center gap-1 border-y px-2.5 py-0.5">
          <span class="min-w-0 flex-1 truncate">{hunk.header}</span>
          {#each actions as a (a.label)}
            <Button
              variant={a.destructive ? "destructive" : "ghost"}
              size="xs"
              class="h-5 font-sans text-[11px]"
              disabled={busy}
              onclick={() => a.run(file, hunk, sel)}
            >
              {sel.size && a.lineLabel ? a.lineLabel : a.label}
            </Button>
          {/each}
        </div>
        {#each hunk.lines as line, li (li)}
          {@const change = line.kind === "add" || line.kind === "del"}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="flex border-l-2 {bg[line.kind]} {sel.has(li) ? 'ring-primary/60 ring-1 ring-inset' : ''} {change &&
            actions.length
              ? 'cursor-pointer'
              : ''}"
            onclick={(e) => change && actions.length && pick(key, hunk, li, e.shiftKey)}
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
      {/each}
    </div>
  {/each}
</div>
