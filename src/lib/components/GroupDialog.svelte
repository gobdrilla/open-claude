<script lang="ts" module>
  /** Repo-Gruppe: claude startet in paths[0] und kennt die uebrigen als weitere Arbeitsordner. */
  export type RepoGroup = { name: string; paths: string[] };
</script>

<script lang="ts">
  import { Button, Checkbox, Dialog, Input, TextButton } from "$lib/atelier-ui";
  import { t } from "$lib/i18n";
  import { fuzzy } from "$lib/fuzzy";

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
  let query = $state("");
  $effect(() => {
    if (group) (name = group.name), (paths = [...group.paths]), (query = "");
  });
  // Chosen repos stay visible, so the search never hides what is in the group.
  const shown = $derived(query.trim() ? repos.filter((r) => paths.includes(r.path) || fuzzy(r.rel, query.trim())) : repos);

  // Verschoben oder geloescht: bleibt sichtbar und entfernbar, zaehlt aber nicht als Repo
  const missing = $derived(paths.filter((p) => !repos.some((r) => r.path === p)));
  const clean = $derived(name.trim());
  const error = $derived(
    !clean
      ? t("Name fehlt")
      : taken.includes(clean)
        ? t("Name schon vergeben")
        : paths.length - missing.length < 2
          ? t("Mindestens zwei Repos wählen")
          : missing[0] === paths[0]
            ? t("Haupt-Repo nicht gefunden")
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
      <Dialog.Title>{group?.name ? t("Gruppe bearbeiten") : t("Neue Repo-Gruppe")}</Dialog.Title>
      <Dialog.Description>{t("Claude startet im Haupt-Repo und kennt die anderen als weitere Arbeitsordner, samt ihrer CLAUDE.md.")}</Dialog.Description>
    </Dialog.Header>
    <Input bind:value={name} placeholder={t("Name, z. B. Shop (Frontend + API)")} onkeydown={(e) => e.key === "Enter" && save()} autofocus />
    <Input bind:value={query} placeholder={t("Projekt suchen")} aria-label={t("Projekt suchen")} />
    <ul class="border-border/60 divide-border/60 min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
      {#each missing as p (p)}
        <li class="flex items-center gap-2.5 px-3 py-1.5">
          <div class="min-w-0 flex-1">
            <div class="text-destructive truncate text-body">{paths[0] === p ? t("nicht gefunden (Haupt-Repo)") : t("nicht gefunden")}</div>
            <div class="text-muted-foreground truncate font-mono text-meta" title={p}>{p}</div>
          </div>
          <TextButton tone="danger" size="sm" onclick={() => toggle(p)}>{t("Entfernen")}</TextButton>
        </li>
      {/each}
      {#each shown as r (r.path)}
        {@const on = paths.includes(r.path)}
        <li class="flex items-center gap-2.5 px-3 py-1.5">
          <Checkbox checked={on} onchange={() => toggle(r.path)} aria-label={t("{name} in die Gruppe", { name: label(r) })} />
          <div class="min-w-0 flex-1">
            <div class="truncate text-body" title={label(r)}>{label(r)}</div>
            <div class="text-muted-foreground truncate font-mono text-meta" title={r.path}>{r.rel}</div>
          </div>
          {#if on && paths[0] === r.path}
            <span class="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-[10px]">{t("Haupt-Repo")}</span>
          {:else if on}
            <TextButton size="sm" onclick={() => makeMain(r.path)}>{t("als Haupt-Repo")}</TextButton>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="flex items-center justify-end gap-2">
      <span class="text-muted-foreground flex-1 text-ui">{error}</span>
      <Button variant="ghost" size="sm" onclick={oncancel}>{t("Abbrechen")}</Button>
      <Button size="sm" disabled={!!error} onclick={save}>{t("Speichern")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
