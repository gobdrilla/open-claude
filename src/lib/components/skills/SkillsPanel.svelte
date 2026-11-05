<script lang="ts">
  import Notice from "$lib/components/Notice.svelte";
  import { IconButton, Input, RefreshButton, SectionHead, Segmented, Select, Switch, TextButton } from "$lib/atelier-ui";
  import PluginsPanel from "./PluginsPanel.svelte";
  import { untrack } from "svelte";
  import { fuzzy } from "$lib/fuzzy";
  import { skills, layers, resolve, adjust, emptyProject, pkey, type SkillsInfo, type ModsInfo, type SkillStore, type ProjectSkills, type Skill, type Source } from "$lib/skills";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import { invoke } from "@tauri-apps/api/core";
  import { t } from "$lib/i18n";

  let {
    repo,
    kind = null,
    store: s,
    onproject,
  }: { repo: string; kind?: string | null; store: SkillStore; onproject: (ps: ProjectSkills) => void } = $props();

  let info = $state<SkillsInfo | null>(null);
  let mods = $state<ModsInfo | null>(null);
  let loading = $state(true);
  let error = $state("");
  let query = $state("");
  let mode = $state<"skills" | "plugins">("skills");
  // Waehrend PluginsPanel die CLI laufen hat, nicht wegschalten
  let pluginsBusy = $state<string | null>(null);

  // Zurueck zu Skills: neu installierte Plugins und ihre Skills zeigen
  function setMode(m: typeof mode) {
    if (m === mode) return;
    mode = m;
    if (m === "skills") reload();
  }

  async function reload() {
    loading = true;
    error = "";
    try {
      [info, mods] = await Promise.all([skills.list(repo), skills.mods()]);
    } catch (e) {
      error = String(e);
    }
    loading = false;
  }

  $effect(() => {
    repo;
    untrack(reload);
  });

  const ps = $derived(s.projects[pkey(repo)]);
  const l = $derived(info && layers(info, s, repo, kind));
  const byKind = $derived((kind && s.kindProfiles[kind]) || t("kein Profil"));
  const names = $derived(Object.keys(s.profiles).sort());

  const match = (sk: Skill) => fuzzy(sk.key, query.trim());
  const own = $derived(info?.skills.filter((sk) => !sk.plugin && match(sk)) ?? []);
  const plugins = $derived(
    (info?.plugins ?? [])
      .map((id) => ({ id, items: info!.skills.filter((sk) => sk.plugin === id && match(sk)) }))
      .filter((g) => g.items.length || fuzzy(g.id, query.trim())),
  );

  const ORIGIN: Record<Source, string> = { default: t("Standard"), user: t("User"), team: t("Team"), profile: t("Profil"), project: t("angepasst") };
  const SOURCE = { user: t("User"), project: t("Projekt"), plugin: t("Plugin") };

  // Select-Werte: "" = nach Typ, NONE = kein Profil, sonst der Name (Namen sind nie leer).
  const NONE = "\0";
  function setProfile(v: string) {
    const { profile: _, ...rest } = ps ?? emptyProject();
    onproject(v === "" ? rest : { ...rest, profile: v === NONE ? null : v });
  }
</script>

<!-- Snippet, weil PluginsPanel ihn als lead bekommt -->
{#snippet modeSwitch()}
  <Segmented
    value={mode}
    options={[
      ["Skills", "skills"],
      ["Plugins", "plugins"],
    ] as const}
    onchange={setMode}
    disabled={!!pluginsBusy}
  />
{/snippet}

{#snippet origin(source: Source, reset: () => void)}
  <span class="w-16 shrink-0 text-right text-meta {source === 'project' ? 'text-primary' : 'text-muted-foreground'}"
    >{ORIGIN[source]}</span
  >
  <IconButton
    size="bare"
    class={source === "project" ? "" : "invisible"}
    label={t("Zurücksetzen")}
    title={t("Projekt-Anpassung zurücksetzen")}
    onclick={reset}><RotateCcwIcon class="size-3" /></IconButton
  >
{/snippet}

{#snippet row(sk: Skill, dim: boolean)}
  {@const v = resolve("skill", sk.key, l!)}
  <li class="flex items-center gap-3 px-3 py-1.5 {dim ? 'opacity-50' : ''}">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate font-mono text-meta font-semibold">{sk.plugin ? sk.name : sk.key}</span>
        <span class="text-muted-foreground border-border rounded border px-1 text-meta">{SOURCE[sk.source]}</span>
        {#if v.value !== "on" && v.value !== "off"}<span class="text-muted-foreground text-meta">{v.value}</span>{/if}
      </div>
      {#if sk.description}<div class="text-muted-foreground truncate text-meta" title={sk.description}>{sk.description}</div>{/if}
    </div>
    {@render origin(v.source, () => onproject(adjust(ps, "skill", sk.key)))}
    <Switch on={v.value !== "off"} label={sk.key} onclick={() => onproject(adjust(ps, "skill", sk.key, v.value === "off" ? "on" : "off"))} />
  </li>
{/snippet}

{#if mode === "plugins"}
  <PluginsPanel {repo} lead={modeSwitch} bind:busy={pluginsBusy} />
{:else}
  <div class="flex h-full min-h-0 flex-col text-ui">
    <Notice bind:text={error} />

    <div class="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
      {@render modeSwitch()}
      <span class="text-muted-foreground">{t("Profil")}</span>
      <Select
        bind:value={() => (ps?.profile === undefined ? "" : (ps.profile ?? NONE)), setProfile}
        options={[[t("Nach Typ ({profile})", { profile: byKind }), ""], [t("Kein Profil"), NONE], ...names.map((n) => [n, n] as const)]}
        aria-label={t("Profil")}
      />
      <span class="flex-1"></span>
      <Input bind:value={query} placeholder={t("Skill suchen")} density="sm" class="w-48" />
      <RefreshButton {loading} onclick={reload} />
    </div>

    {#if loading && !info}
      <p class="text-muted-foreground px-3 py-4">{t("Lese Skills …")}</p>
    {:else if l}
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if !own.length && !plugins.length}
          <p class="text-muted-foreground px-3 py-4">{query.trim() ? t("Kein Skill passt zu „{q}“.", { q: query.trim() }) : t("Keine Skills gefunden.")}</p>
        {/if}
        <ul>
          {#each own as sk (sk.key)}{@render row(sk, false)}{/each}
        </ul>
        {#each plugins as g (g.id)}
          {@const pv = resolve("plugin", g.id, l)}
          <SectionHead title={g.id} mono>
            {@render origin(pv.source, () => onproject(adjust(ps, "plugin", g.id)))}
            <Switch on={pv.value} label={g.id} onclick={() => onproject(adjust(ps, "plugin", g.id, !pv.value))} />
          </SectionHead>
          <ul>
            {#each g.items as sk (sk.key)}{@render row(sk, !pv.value)}{/each}
          </ul>
        {/each}
        {#if mods}
          <SectionHead title="Mods">
            <TextButton
              size="sm"
              title={mods.dir}
              onclick={() => invoke("reveal", { path: mods!.dir }).catch((e) => (error = String(e)))}>{t("Ordner öffnen")}</TextButton
            >
          </SectionHead>
          <p class="text-muted-foreground px-3 py-1.5 text-meta">
            {t("Mods greifen beim nächsten Claude-Start im Terminal.")}{mods.mods.length ? "" : " " + t("Noch keine Mods installiert.")}
          </p>
          <ul>
            {#each mods.mods as m (m.path)}
              <li class="px-3 py-1.5">
                <div class="truncate font-mono text-meta font-semibold">{m.name}</div>
                {#if m.description}<div class="text-muted-foreground truncate text-meta" title={m.description}>{m.description}</div>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
{/if}
