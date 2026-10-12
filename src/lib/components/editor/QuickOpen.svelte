<script lang="ts">
  // Strg+P: Datei des Projekts per Fuzzy-Suche oeffnen. Die Liste kommt bei jedem Oeffnen frisch (git ls-files, ohne Git alle Dateien).
  // Praefix "@": Symbole der aktiven Datei (Strg+Umschalt+O), "#": Symbole im Projekt (Strg+T), beides ueber laufende Language-Server.
  import * as Command from "$lib/components/ui/command/index.js";
  import { fuzzy } from "$lib/fuzzy";
  import { fs } from "$lib/files";
  import { editor, open as openFile } from "$lib/editor.svelte";
  import { fileIcon } from "$lib/components/kit";
  import { documentSymbols, workspaceSymbols, type SymHit } from "$lib/lsp.svelte";

  let { repo, open = $bindable(false), initial = "" }: { repo: string; open: boolean; initial?: string } = $props();

  let files = $state<string[]>([]);
  let query = $state("");
  let syms = $state<SymHit[]>([]);
  const mode = $derived(query[0] === "@" || query[0] === "#" ? query[0] : "");

  $effect(() => {
    if (!open) return;
    query = initial;
    fs.files(repo).then(
      (f) => (files = f),
      (e) => (editor(repo).error = String(e)),
    );
  });

  // "@": einmal laden, gefiltert wird hier.
  $effect(() => {
    syms = [];
    const path = editor(repo).active;
    if (!open || mode !== "@" || !path) return;
    let live = true;
    documentSymbols(repo, path).then(
      (r) => live && (syms = r),
      (e) => (editor(repo).error = String(e)),
    );
    return () => void (live = false);
  });

  // "#": der Server filtert, darum entprellt bei jeder Eingabe fragen.
  $effect(() => {
    if (!open || mode !== "#") return;
    const q = query.slice(1).trim();
    let live = true;
    const t = setTimeout(() => workspaceSymbols(repo, q).then((r) => live && (syms = r)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  });

  const symHits = $derived.by(() => {
    if (mode !== "@") return mode ? syms.slice(0, 50) : [];
    const q = query.slice(1).trim();
    return syms
      .flatMap((s) => {
        const m = fuzzy(s.name, q);
        return m ? [{ s, score: m.score }] : [];
      })
      .sort((a, b) => b.score - a.score || a.s.line - b.s.line)
      .slice(0, 50)
      .map((h) => h.s);
  });

  // ponytail: jede Eingabe sucht linear ueber alle Dateien; bei sehr grossen Repos entprellen oder in Rust suchen.
  const hits = $derived.by(() => {
    const q = query.trim();
    if (mode) return [];
    if (!q) return files.slice(0, 50);
    return files
      .flatMap((path) => {
        const m = fuzzy(path, q);
        return m ? [{ path, score: m.score }] : [];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((h) => h.path);
  });

  function pick(path: string) {
    open = false;
    openFile(repo, path);
  }

  function pickSym(s: SymHit) {
    open = false;
    openFile(repo, s.path, s.line, s.col);
  }
</script>

<Command.Dialog bind:open shouldFilter={false} title="Datei öffnen" description="Datei im Projekt suchen">
  <Command.Input bind:value={query} placeholder="Datei öffnen (@ Symbol in Datei, # Symbol im Projekt)" />
  <Command.List>
    <Command.Empty>{mode ? "Keine Symbole gefunden (Language-Server aktiv?)." : "Keine Datei gefunden."}</Command.Empty>
    {#each symHits as s, i (i)}
      <Command.Item value={`${i}:${s.path}:${s.line}:${s.name}`} onSelect={() => pickSym(s)}>
        <span class="truncate">{s.name}</span>
        <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {[s.container, mode === "#" ? s.path : ""].filter(Boolean).join(" · ")}
        </span>
        <span class="text-muted-foreground text-xs tabular-nums">{s.line}</span>
      </Command.Item>
    {/each}
    {#each hits as path (path)}
      {@const cut = path.lastIndexOf("/") + 1}
      {@const ic = fileIcon(path)}
      <Command.Item value={path} onSelect={() => pick(path)}>
        <ic.icon class="size-3.5 {ic.tint}" />
        <span class="truncate">{path.slice(cut)}</span>
        <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">{path.slice(0, cut)}</span>
      </Command.Item>
    {/each}
  </Command.List>
</Command.Dialog>
