<script lang="ts">
  import { Button, Input, Row, SectionToggle, Segmented } from "$lib/atelier-ui";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { theme } from "$lib/theme.svelte";
  import { t } from "$lib/i18n";
  import { css, hex, type Oklch } from "$lib/color";
  import { CODE_SCHEMES, derive, origin, parentOf, type ColorId, type Theme } from "$lib/themes";
  import { current, editTheme, themeEditor } from "$lib/themes.svelte";
  import { COLOR_GROUPS, COLOR_LABEL, SCHEME_LABELS } from "./labels";
  import ColorFields from "./ColorFields.svelte";

  // Every color of the active theme for the current mode, grouped. A click on a row opens its sliders in place;
  // a color without its own value shows what it follows ("wie Panels").
  const th = $derived(current());
  const dark = $derived(theme.dark);
  const pal = $derived(derive(th, dark));

  let q = $state("");
  let open = $state<Record<string, boolean>>({ base: true, areas: true });
  // Shared with the pick mode: a click into the app selects a color here.
  const sel = $derived(themeEditor.sel);
  let list = $state<HTMLDivElement>();
  $effect(() => {
    if (!sel || !list) return;
    // After the group opened and the sliders rendered.
    requestAnimationFrame(() => list?.querySelector(`[data-color="${sel}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  const needle = $derived(q.trim().toLowerCase());
  const groups = $derived(
    COLOR_GROUPS.map((g) => ({ ...g, colors: needle ? g.colors.filter(([, name]) => name.toLowerCase().includes(needle)) : g.colors })).filter((g) => g.colors.length),
  );

  const mine = (x: Theme, other = false) => ((dark !== other) ? x.colors.dark : x.colors.light);
  const label = (id: ColorId) => COLOR_LABEL[id] ?? id;
  const follows = (id: ColorId) => t("wie {name}", { name: label(parentOf(id)!) });
  const setColor = (id: ColorId, v: Oklch) => editTheme((x) => (mine(x)[id] = v));
  const reset = (id: ColorId) => editTheme((x) => delete mine(x)[id]);
  const copyOther = (id: ColorId) => editTheme((x) => (mine(x, true)[id] = { ...pal[id] }));
  // A group is open while searching or while it holds the selected color (e.g. picked in the app).
  const shown = (gid: string, colors: [ColorId, string][]) => !!needle || !!open[gid] || colors.some(([id]) => id === sel);
  function toggle(gid: string, colors: [ColorId, string][]) {
    const was = shown(gid, colors);
    open[gid] = !was;
    if (was && colors.some(([id]) => id === sel)) themeEditor.sel = null;
  }
  const ownCount =(colors: [ColorId, string][]) => colors.filter(([id]) => mine(th)[id]).length;
</script>

<div bind:this={list} class="flex flex-col gap-0.5 p-2">
  <label class="border-input text-muted-foreground mb-1 flex h-7 items-center gap-1.5 rounded-lg border px-2">
    <SearchIcon class="size-3.5 shrink-0" />
    <Input density="xs" class="h-6 border-0 bg-transparent! px-0 focus-visible:ring-0" placeholder={t("Farbe suchen")} aria-label={t("Farbe suchen")} bind:value={q} />
  </label>
  {#each groups as g (g.id)}
    {@const isOpen = shown(g.id, g.colors)}
    {@const n = ownCount(g.colors)}
    <SectionToggle open={isOpen} onclick={() => toggle(g.id, g.colors)}>
      <span class="flex-1">{g.label}</span>
      {#if n}<span class="text-primary font-normal">{t(n === 1 ? "{n} eigene Farbe" : "{n} eigene Farben", { n })}</span>{/if}
    </SectionToggle>
    {#if isOpen}
      {#if g.hint && !needle}<p class="text-muted-foreground text-meta mb-0.5 pl-7">{g.hint}</p>{/if}
      {#if g.id === "code" && !needle}
        <div class="mb-1 flex items-center gap-2 pl-7">
          <span class="text-muted-foreground text-meta">{t("Schema")}</span>
          <Segmented label={t("Editor-Farbschema")} value={th.code} options={CODE_SCHEMES.map((s) => [SCHEME_LABELS[s], s] as const)} onchange={(s) => editTheme((x) => (x.code = s))} />
        </div>
      {/if}
      {#each g.colors as [id, name] (id)}
        {@const from = origin(th, dark, id)}
        <div data-color={id} class="flex flex-col gap-0.5 scroll-my-2">
        <Row text="md" indent class="gap-2" selected={sel === id} aria-expanded={sel === id} onclick={() => (themeEditor.sel = sel === id ? null : id)}>
          <span class="ring-foreground/20 size-3.5 shrink-0 rounded-sm ring-1" style:background={css(pal[id])}></span>
          <span class="min-w-0 flex-1 truncate">{name}</span>
          {#if from === "own"}<span class="bg-primary size-1.5 shrink-0 rounded-full" title={t("Eigene Farbe")}></span>{/if}
          <span class="text-muted-foreground text-meta shrink-0 {from === 'follows' ? '' : 'font-mono'}">{from === "follows" ? follows(id) : hex(pal[id]).toUpperCase()}</span>
        </Row>
        {#if sel === id}
          <div class="border-border/60 bg-background/40 mt-0.5 mb-1.5 ml-6 flex flex-col gap-2 rounded-md border p-2.5">
            <ColorFields value={pal[id]} onchange={(v) => setColor(id, v)} />
            <p class="text-muted-foreground text-meta">
              {from === "own" ? t("Eigene Farbe") : from === "scheme" ? t("Aus dem Editor-Farbschema") : from === "follows" ? t("Folgt „{name}“, bis du sie änderst.", { name: label(parentOf(id)!) }) : t("Standardfarbe")}
            </p>
            <div class="-mt-1 flex flex-wrap items-center justify-end gap-1.5">
              <Button variant="ghost" size="xs" onclick={() => copyOther(id)}>{dark ? t("Auch für Hell") : t("Auch für Dunkel")}</Button>
              {#if from === "own"}
                <Button variant="outline" size="xs" onclick={() => reset(id)}>{t("Eigene Farbe entfernen")}</Button>
              {/if}
            </div>
          </div>
        {/if}
        </div>
      {/each}
    {/if}
  {/each}
  {#if !groups.length}<p class="text-muted-foreground text-ui px-2 py-4 text-center">{t("Keine Farbe mit „{q}“.", { q: q.trim() })}</p>{/if}
</div>
