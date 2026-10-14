<script lang="ts" module>
  /** Repo-Gruppe: claude startet in paths[0] und kennt die uebrigen als weitere Arbeitsordner. */
  export type RepoGroup = { name: string; paths: string[] };
</script>

<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  type Repo = { path: string; rel: string };

  let {
    group,
    repos,
    taken,
    onsave,
    oncancel,
  }: {
    // null = zu; beim Anlegen name leer und paths mit dem Ausgangs-Repo
    group: RepoGroup | null;
    repos: Repo[];
    // Namen anderer Gruppen (eindeutig, dienen als Schluessel)
    taken: string[];
    onsave: (g: RepoGroup) => void;
    oncancel: () => void;
  } = $props();

  let name = $state("");
  let paths = $state<string[]>([]);
  $effect(() => {
    if (group) (name = group.name), (paths = [...group.paths]);
  });

  // Verschoben oder geloescht: bleibt sichtbar und entfernbar, zaehlt aber nicht als Repo
  const missing = $derived(paths.filter((p) => !repos.some((r) => r.path === p)));
  const clean = $derived(name.trim());
  const error = $derived(
    !clean
      ? "Name fehlt"
      : taken.includes(clean)
        ? "Name schon vergeben"
        : paths.length - missing.length < 2
          ? "Mindestens zwei Repos wählen"
          : missing[0] === paths[0]
            ? "Haupt-Repo nicht gefunden"
            : "",
  );
  const label = (r: Repo) => r.rel.split(/[\\/]/).pop() || r.rel;

  function toggle(p: string) {
    paths = paths.includes(p) ? paths.filter((x) => x !== p) : [...paths, p];
  }
  // Haupt-Repo nach vorn: dort startet claude
  const makeMain = (p: string) => (paths = [p, ...paths.filter((x) => x !== p)]);
  const save = () => !error && onsave({ name: clean, paths });
</script>

<Dialog.Root open={group !== null} onOpenChange={(o) => !o && oncancel()}>
  <Dialog.Content class="flex max-h-[80vh] flex-col sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{group?.name ? "Gruppe bearbeiten" : "Neue Repo-Gruppe"}</Dialog.Title>
      <Dialog.Description>Claude startet im Haupt-Repo und kennt die anderen als weitere Arbeitsordner, samt ihrer CLAUDE.md.</Dialog.Description>
    </Dialog.Header>
    <Input bind:value={name} placeholder="Name, z. B. Shop (Frontend + API)" onkeydown={(e) => e.key === "Enter" && save()} autofocus />
    <ul class="border-border/60 divide-border/60 min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
      {#each missing as p (p)}
        <li class="flex items-center gap-2.5 px-3 py-1.5">
          <div class="min-w-0 flex-1">
            <div class="text-destructive truncate text-sm">nicht gefunden{paths[0] === p ? " (Haupt-Repo)" : ""}</div>
            <div class="text-muted-foreground truncate font-mono text-[10px]" title={p}>{p}</div>
          </div>
          <button class="text-muted-foreground hover:text-destructive text-[10px]" onclick={() => toggle(p)}>Entfernen</button>
        </li>
      {/each}
      {#each repos as r (r.path)}
        {@const on = paths.includes(r.path)}
        <li class="flex items-center gap-2.5 px-3 py-1.5">
          <input type="checkbox" checked={on} onchange={() => toggle(r.path)} aria-label="{label(r)} in die Gruppe" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm" title={label(r)}>{label(r)}</div>
            <div class="text-muted-foreground truncate font-mono text-[10px]" title={r.path}>{r.rel}</div>
          </div>
          {#if on && paths[0] === r.path}
            <span class="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-[10px]">Haupt-Repo</span>
          {:else if on}
            <button class="text-muted-foreground hover:text-foreground text-[10px]" onclick={() => makeMain(r.path)}>als Haupt-Repo</button>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="flex items-center justify-end gap-2">
      <span class="text-muted-foreground flex-1 text-xs">{error}</span>
      <Button variant="ghost" size="sm" onclick={oncancel}>Abbrechen</Button>
      <Button size="sm" disabled={!!error} onclick={save}>Speichern</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
