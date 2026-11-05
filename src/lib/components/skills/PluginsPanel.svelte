<script lang="ts">
  import { Asker } from "$lib/confirm.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import { Button, ConfirmBar, IconButton, Input, RefreshButton, SectionHead, Segmented, Switch } from "$lib/atelier-ui";
  import { untrack, type Snippet } from "svelte";
  import { fuzzy } from "$lib/fuzzy";
  import { skills, groupInstalled, pickAvailable, type PluginsInfo, type PluginAction, type InstalledPlugin } from "$lib/skills";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { t } from "$lib/i18n";

  let { repo, lead, busy = $bindable(null) }: { repo: string; lead?: Snippet; busy?: string | null } = $props();

  let info = $state<PluginsInfo | null>(null);
  let loading = $state(true);
  let error = $state("");
  let note = $state("");
  let query = $state("");
  let scopeChoice = $state<"user" | "project">("user");
  let source = $state("");
  // Laeuft im Skills-Dialog: Rueckfragen als Leiste darin, kein Dialog im Dialog.
  const asker = new Asker();
  const confirm = asker.ask;

  async function reload() {
    loading = true;
    try {
      info = await skills.plugins(repo);
    } catch (e) {
      error = String(e);
    }
    loading = false;
  }

  $effect(() => {
    repo;
    untrack(reload);
  });

  const RESTART: PluginAction[] = ["install", "update", "enable", "disable"];

  /** Ein CLI-Aufruf samt Bestaetigung eines Marketplace-Kommandos; Notiz bei Erfolg, null wenn abgelehnt, wirft bei Fehler. */
  async function exec(action: PluginAction, target: string, scope?: string, cwd = repo) {
    let res = await skills.pluginRun(cwd, action, target, scope);
    const shown = res.shownCommand;
    if (shown?.sha256) {
      const cmd = JSON.stringify(shown.command ?? shown);
      if (!(await confirm(t("Der Marketplace will dieses Kommando ausführen:\n{cmd}", { cmd }), t("Zulassen")))) return null;
      res = await skills.pluginRun(cwd, action, target, scope, shown.sha256);
    }
    if (res.outcome !== "ok") throw res.message ?? JSON.stringify(res);
    if (res.updateOutcome === "up_to_date") return t("Bereits aktuell.");
    return (res.message ?? t("Erledigt.")) + (RESTART.includes(action) ? " " + t("Greift beim nächsten Claude-Start.") : "");
  }

  /** Mehrere Aufrufe nacheinander (eine Sperre); Fehler je Aufruf gesammelt. true wenn alle ok. */
  async function batch(key: string, calls: [PluginAction, string, string?, string?][]) {
    busy = key;
    error = note = "";
    const notes: string[] = [];
    const errs: string[] = [];
    for (const [action, target, scope, cwd] of calls) {
      const label = calls.length > 1 ? `${cwd && cwd !== repo ? folder(cwd) : target}: ` : "";
      try {
        const n = await exec(action, target, scope, cwd);
        if (n === null) errs.push(label + t("abgelehnt"));
        else notes.push(label + n);
      } catch (e) {
        errs.push(label + String(e));
      }
    }
    note = notes.join("\n");
    error = errs.join("\n");
    busy = null;
    await reload();
    return !errs.length;
  }

  const run = (action: PluginAction, target: string, scope?: string, cwd = repo) => batch(target, [[action, target, scope, cwd]]);

  const checkUpdates = () => batch("updates", Object.keys(info?.marketplaces ?? {}).map((n) => ["mp-update", n] as [PluginAction, string]));

  /** Alle Installationen eines Plugins updaten, auch lokale (dort hat local Vorrang). */
  const updateAll = (g: { id: string; main?: InstalledPlugin; locals: InstalledPlugin[] }) =>
    batch(
      g.id,
      [...(g.main ? [g.main] : []), ...g.locals].map((p) => ["update", g.id, p.scope, p.projectPath ?? repo]),
    );

  async function addMarketplace() {
    if (await run("mp-add", source.trim())) source = "";
  }

  const folder = (p?: string) => p?.split(/[\\/]/).filter(Boolean).pop() ?? p ?? "";
  const SCOPE = { user: t("User"), project: t("Projekt"), local: t("lokal") };

  async function remove(p: InstalledPlugin) {
    if (!(await confirm(t("{id} aus {scope} entfernen? Gespeicherte Plugin-Daten werden gelöscht.", { id: p.id, scope: SCOPE[p.scope] }), t("Entfernen")))) return;
    run("uninstall", p.id, p.scope, p.projectPath ?? repo);
  }

  const q = $derived(query.trim());
  const desc = (id: string) => info?.meta[id]?.description ?? "";
  const groups = $derived(info ? groupInstalled(info.installed).filter((g) => fuzzy(`${g.id} ${desc(g.id)}`, q)) : []);
  const avail = $derived(info ? pickAvailable(info.available, new Set(info.installed.map((p) => p.id)), q) : { items: [], total: 0 });
  const mps = $derived(Object.entries(info?.marketplaces ?? {}).filter(([n]) => fuzzy(n, q)));
  const mpSource = (s: PluginsInfo["marketplaces"][string]["source"]) => s.repo ?? s.url ?? s.path ?? s.source;
</script>

{#snippet action(label: string, id: string, onclick: () => void, title = "")}
  <Button variant="outline" size="2xs" {title} disabled={!!busy} {onclick}
    >{busy === id ? "…" : label}</Button
  >
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui">
  <Notice bind:text={error} />
  <Notice bind:text={note} kind="note" />
  <ConfirmBar {asker} class="mx-3 mt-2" />

  <div class="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
    {@render lead?.()}
    <span class="flex-1"></span>
    <Input bind:value={query} placeholder={t("Plugin suchen")} density="sm" class="w-48" />
    <Button
      variant="outline"
      size="xs"
      title={t("Marketplaces aktualisieren und nach neuen Versionen suchen")}
      disabled={!!busy || !info}
      onclick={checkUpdates}>{busy === "updates" ? t("Prüfe …") : t("Updates prüfen")}</Button
    >
    <RefreshButton loading={loading || busy === "updates"} disabled={loading || !!busy} onclick={reload} />
  </div>

  {#if loading && !info}
    <p class="text-muted-foreground px-3 py-4">{t("Lese Plugins …")}</p>
  {:else if info}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <SectionHead title={t("Installiert ({n})", { n: groups.length })} />
      {#if !groups.length}
        <p class="text-muted-foreground px-3 py-2">{q ? t("Kein Plugin passt zu „{q}“.", { q }) : t("Keine Plugins installiert.")}</p>
      {/if}
      <ul>
        {#each groups as g (g.id)}
          {@const m = info.meta[g.id]}
          {@const p = g.main ?? g.locals[0]}
          <li class="flex items-center gap-3 px-3 py-1.5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-mono text-meta font-semibold">{g.id}</span>
                <span class="text-muted-foreground shrink-0 font-mono text-meta"
                  >{p.version}{#if m?.update && m.latest}&nbsp;→ <span class="text-primary">{m.latest}</span>{/if}</span
                >
                {#if g.main}<span class="text-muted-foreground border-border rounded border px-1 text-meta">{SCOPE[g.main.scope]}</span>{/if}
              </div>
              {#if m?.description}<div class="text-muted-foreground truncate text-meta" title={m.description}>{m.description}</div>{/if}
              {#if g.locals.length}
                <div class="text-muted-foreground truncate text-meta" title={g.locals.map((l) => l.projectPath).join("\n")}>
                  {t(g.main ? "auch lokal in: {list}" : "lokal in: {list}", { list: g.locals.map((l) => folder(l.projectPath)).join(", ") })}
                </div>
              {/if}
            </div>
            {#if m?.update}
              {@render action(t("Update"), g.id, () => updateAll(g))}
            {:else if !m?.latest}
              <!-- Neueste Version unbekannt: CLI entscheidet selbst (up_to_date) -->
              {@render action(t("Update suchen"), g.id, () => updateAll(g), t("Neueste Version unbekannt"))}
            {/if}
            {#if g.main}
              {@const main = g.main}
              <Switch
                on={main.enabled}
                label={g.id}
                disabled={!!busy}
                onclick={() => run(main.enabled ? "disable" : "enable", g.id, main.scope, main.projectPath ?? repo)}
              />
              <IconButton
                size="bare"
                tone="danger"
                label={t("Entfernen")}
                title={t("Aus {scope} entfernen", { scope: SCOPE[main.scope] })}
                disabled={!!busy}
                onclick={() => remove(main)}><Trash2Icon class="size-3.5" /></IconButton
              >
            {:else}
              <span class="text-muted-foreground w-24 shrink-0 text-right text-meta">{t("pro Projekt im Skills-Modus")}</span>
            {/if}
          </li>
        {/each}
      </ul>

      <SectionHead title={t("Verfügbar ({n} von {total})", { n: avail.items.length, total: avail.total })}>
        <span class="text-muted-foreground text-meta">Scope</span>
        <Segmented
          value={scopeChoice}
          options={[
            [t("User"), "user"],
            [t("Projekt"), "project"],
          ] as const}
          onchange={(v) => (scopeChoice = v)}
          disabled={!!busy}
        />
      </SectionHead>
      {#if !avail.items.length}
        <p class="text-muted-foreground px-3 py-2">{q ? t("Kein Plugin passt zu „{q}“.", { q }) : t("Keine weiteren Plugins verfügbar.")}</p>
      {/if}
      <ul>
        {#each avail.items as a (a.pluginId)}
          <li class="flex items-center gap-3 px-3 py-1.5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-mono text-meta font-semibold">{a.name}</span>
                <span class="text-muted-foreground truncate text-meta">{a.marketplaceName}</span>
                {#if a.version}<span class="text-muted-foreground shrink-0 font-mono text-meta">v{a.version}</span>{/if}
                {#if a.installCount}<span class="text-muted-foreground shrink-0 text-meta">↓{a.installCount}</span>{/if}
              </div>
              {#if a.description}<div class="text-muted-foreground truncate text-meta" title={a.description}>{a.description}</div>{/if}
            </div>
            {@render action(t("Installieren"), a.pluginId, () => run("install", a.pluginId, scopeChoice))}
          </li>
        {/each}
      </ul>

      <SectionHead title={`Marketplaces (${mps.length})`} />
      {#if !mps.length}
        <p class="text-muted-foreground px-3 py-2">
          {q ? t("Kein Marketplace passt zu „{q}“.", { q }) : t("Keine Marketplaces. Füge einen hinzu (z. B. anthropics/claude-plugins-official).")}
        </p>
      {/if}
      <ul>
        {#each mps as [name, mp] (name)}
          <li class="flex items-center gap-3 px-3 py-1.5">
            <span class="w-48 shrink-0 truncate font-mono text-meta font-semibold">{name}</span>
            <span class="text-muted-foreground min-w-0 flex-1 truncate text-meta" title={mp.installLocation}>{mpSource(mp.source)}</span>
            {@render action(t("Aktualisieren"), name, () => run("mp-update", name))}
            {@render action(t("Entfernen"), name, async () => {
              if (await confirm(t("Marketplace {name} entfernen? Seine Plugins sind danach nicht mehr installierbar.", { name }), t("Entfernen"))) run("mp-remove", name);
            })}
          </li>
        {/each}
      </ul>
      <form
        class="flex items-center gap-2 px-3 py-2"
        onsubmit={(e) => {
          e.preventDefault();
          if (source.trim()) addMarketplace();
        }}
      >
        <Input bind:value={source} placeholder={t("owner/repo, https-/git-URL oder Pfad")} density="sm" class="flex-1" />
        <Button type="submit" variant="outline" size="xs" disabled={!!busy || !source.trim()}
          >{busy === source.trim() && busy ? "…" : t("Hinzufügen")}</Button
        >
      </form>
    </div>
  {:else}
    <p class="text-muted-foreground px-3 py-4">{t("Plugins konnten nicht gelesen werden.")}</p>
  {/if}
</div>
