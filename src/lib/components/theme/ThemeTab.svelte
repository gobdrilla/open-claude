<script lang="ts">
  import { Button, IconButton, Segmented, Select, SettingRow, SettingsSection, Slider, Switch, Textarea } from "$lib/atelier-ui";
  import CheckIcon from "@lucide/svelte/icons/check";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { theme, setMode } from "$lib/theme.svelte";
  import { t } from "$lib/i18n";
  import { css } from "$lib/color";
  import { GLOW_AT, PRESETS, REFS, TOKENS, derive, gradientCss, isPreset, refColor, report, type Theme } from "$lib/themes";
  import { copyTheme, current, deleteTheme, editTheme, exportTheme, importTheme, selectTheme, themes } from "$lib/themes.svelte";
  import { GLOW_LABELS, REF_LABELS } from "./labels";
  import ColorPicker from "./ColorPicker.svelte";
  import GradientEditor from "./GradientEditor.svelte";

  const th = $derived(current());
  const preset = $derived(isPreset(th.id));
  const modeName = $derived(theme.dark ? t("Dunkel") : t("Hell"));
  const tokens = $derived(derive(th, theme.dark));
  const checks = $derived(report(th, theme.dark));
  const all = $derived([...PRESETS, ...themes.own]);

  // Seeds without lightness get a mid preview lightness in the picker.
  const seed = (v: { h: number; c: number }) => ({ l: theme.dark ? 0.72 : 0.55, c: v.c, h: v.h });

  /** Card preview: background, backdrop gradient and accent dot of the theme in the current mode. */
  function look(x: Theme) {
    const tk = derive(x, theme.dark);
    const bg = x.backdrop.on ? `${gradientCss(x.backdrop.gradient, true, (r) => css(refColor(x, tk, r, theme.dark)))}, ` : "";
    return { bg: `${bg}${css(tk.background)}`, fg: css(tk.foreground), dot: css(tk.primary), card: css(tk.card) };
  }

  let importing = $state(false);
  let pasted = $state("");
  let note = $state("");
  // No clipboard.readText(): WebKit answers it with a paste callout or not at all; Cmd/Ctrl+V into the field works everywhere.
  function startImport() {
    importing = !importing;
    note = "";
  }
  function doImport() {
    const x = importTheme(pasted);
    note = x ? t("„{name}“ importiert.", { name: x.name }) : t("Kein gültiges Theme (JSON mit \"version\": 1).");
    if (x) importing = false;
  }
  async function doExport() {
    await navigator.clipboard.writeText(exportTheme()).then(
      () => (note = t("Theme als JSON in die Zwischenablage kopiert.")),
      () => (note = t("Zwischenablage nicht verfügbar.")),
    );
  }

  let advanced = $state(false);
  const overrides = $derived(theme.dark ? th.overrides.dark : th.overrides.light);
</script>

<div class="flex flex-col gap-6">
  <SettingsSection title={t("Theme")}>
    <div class="grid grid-cols-3 gap-2 p-2">
      {#each all as x (x.id)}
        {@const l = look(x)}
        <button
          class="ring-foreground/10 hover:ring-foreground/25 flex h-16 flex-col justify-between overflow-hidden rounded-lg p-2 text-left ring-1 {x.id === th.id ? 'ring-ring! ring-2' : ''}"
          style:background={l.bg}
          aria-pressed={x.id === th.id}
          onclick={() => ((note = ""), selectTheme(x.id))}
        >
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full" style:background={l.dot}></span>
            <span class="h-1.5 w-8 rounded-full" style:background={l.card}></span>
          </span>
          <span class="text-ui truncate font-medium" style:color={l.fg}>{x.name}</span>
        </button>
      {/each}
    </div>
    <SettingRow label={t("Modus")} description={t("Hell, dunkel oder wie das System. Jedes Theme hat beide Varianten.")}>
      <Segmented value={theme.mode} options={[["System", "system"], [t("Hell"), "light"], [t("Dunkel"), "dark"]] as const} onchange={setMode} />
    </SettingRow>
    <div class="flex flex-wrap items-center gap-2 px-2 py-2">
      {#if !preset}
        <input
          class="bg-secondary border-border h-7 w-44 rounded border px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={t("Name")}
          maxlength="40"
          value={th.name}
          oninput={(e) => editTheme((x) => (x.name = e.currentTarget.value))}
        />
      {/if}
      <Button variant="outline" size="sm" onclick={copyTheme}>{t("Duplizieren")}</Button>
      <Button variant="outline" size="sm" onclick={doExport}>{t("Exportieren")}</Button>
      <Button variant="outline" size="sm" aria-expanded={importing} onclick={startImport}>{t("Importieren")}</Button>
      {#if !preset}
        <IconButton size="md" tone="danger" label={t("Theme {name} löschen", { name: th.name })} onclick={() => ((note = ""), deleteTheme(th.id))}><TrashIcon class="size-3.5" /></IconButton>
      {/if}
      {#if note}<span class="text-muted-foreground text-meta" role="status">{note}</span>{/if}
    </div>
    {#if importing}
      <div class="flex flex-col gap-1.5 px-2 py-2">
        <Textarea bind:value={pasted} class="h-24 font-mono text-meta" placeholder={t("Theme-JSON hier einfügen")} aria-label={t("Theme-JSON")} />
        <Button size="sm" class="self-end" disabled={!pasted.trim()} onclick={doImport}>{t("Übernehmen")}</Button>
      </div>
    {/if}
  </SettingsSection>

  {#if preset}
    <p class="text-muted-foreground text-meta -mt-4 px-1">{t("Eingebaute Themes bleiben unverändert: Die erste Änderung legt eine Kopie an.")}</p>
  {/if}

  <SettingsSection title={t("Farben")}>
    <SettingRow label={t("Akzent")} description={t("Buttons, Auswahl, Fokus. Die Helligkeit wählt die App je Modus für guten Kontrast.")}>
      <ColorPicker value={seed(th.accent)} lightness={false} label={t("Akzent")} onchange={(v) => editTheme((x) => (x.accent = { h: v.h, c: v.c }))} />
    </SettingRow>
    <SettingRow label={t("Zweiter Akzent")} description={t("Endfarbe der Verläufe auf Buttons und Logo.")}>
      {#if th.accent2}
        <ColorPicker value={seed(th.accent2)} lightness={false} label={t("Zweiter Akzent")} onchange={(v) => editTheme((x) => (x.accent2 = { h: v.h, c: v.c }))} />
      {/if}
      <Switch on={!!th.accent2} label={t("Zweiter Akzent")} onclick={() => editTheme((x) => (x.accent2 = x.accent2 ? null : { h: (x.accent.h + 60) % 360, c: x.accent.c }))} />
    </SettingRow>
    <SettingRow label={t("Grundton")} description={t("Färbt Flächen und Text leicht ein; Sättigung 0 ist reines Grau.")}>
      <ColorPicker value={seed(th.base)} lightness={false} maxC={0.08} label={t("Grundton")} onchange={(v) => editTheme((x) => (x.base = { h: v.h, c: v.c }))} />
    </SettingRow>
    <SettingRow label={t("Flächen")} description={t("Tiefer oder heller als Standard.")}>
      <Slider class="w-32" min={-100} max={100} value={th.surface} aria-label={t("Flächen")} oninput={(e) => editTheme((x) => (x.surface = +e.currentTarget.value))} />
    </SettingRow>
    <SettingRow label={t("Kontrast")} description={t("Abstand zwischen Flächen, Rändern und Text. Text bleibt immer lesbar (WCAG AA).")}>
      <Slider class="w-32" min={0} max={100} value={th.contrast} aria-label={t("Kontrast")} oninput={(e) => editTheme((x) => (x.contrast = +e.currentTarget.value))} />
    </SettingRow>
  </SettingsSection>

  <SettingsSection title={t("Verläufe und Effekte")}>
    <SettingRow label={t("Schimmer")} description={t("Farbverlauf in einer Ecke von Karten und Dialogen.")}>
      <Select value={th.glowRef} options={REFS.map((r) => [REF_LABELS[r], r] as const)} aria-label={t("Farbe des Schimmers")} onchange={(v) => editTheme((x) => (x.glowRef = v as Theme["glowRef"]))} />
      <Select value={th.glowAt} options={GLOW_AT.map((a) => [GLOW_LABELS[a], a] as const)} aria-label={t("Ecke des Schimmers")} onchange={(v) => editTheme((x) => (x.glowAt = v as Theme["glowAt"]))} />
      <Slider class="w-24" min={0} max={30} value={th.glow} aria-label={t("Stärke des Schimmers")} oninput={(e) => editTheme((x) => (x.glow = +e.currentTarget.value))} />
    </SettingRow>
    <SettingRow label={t("Hintergrund-Verlauf")} description={t("Hinter der ganzen App, sichtbar zwischen den Bereichen und in der Projektliste.")}>
      {#if th.backdrop.on}
        <Slider class="w-24" min={0} max={100} value={th.backdrop.strength} aria-label={t("Stärke des Verlaufs")} oninput={(e) => editTheme((x) => (x.backdrop.strength = +e.currentTarget.value))} />
      {/if}
      <Switch on={th.backdrop.on} label={t("Hintergrund-Verlauf")} onclick={() => editTheme((x) => (x.backdrop.on = !x.backdrop.on))} />
    </SettingRow>
    {#if th.backdrop.on}
      <GradientEditor g={th.backdrop.gradient} change={(fn) => editTheme((x) => fn(x.backdrop.gradient))} />
    {/if}
    <SettingRow label={t("Körnung")} description={t("Feines Rauschen über dem Hintergrund, glättet Stufen im Verlauf.")}>
      <Slider class="w-24" min={0} max={100} value={th.grain} aria-label={t("Körnung")} oninput={(e) => editTheme((x) => (x.grain = +e.currentTarget.value))} />
    </SettingRow>
  </SettingsSection>

  <SettingsSection title={t("Kontrast ({mode})", { mode: modeName })}>
    {#each checks as c (c.label)}
      {@const ok = c.ratio >= c.min}
      <div class="flex items-center gap-2 px-2 py-1.5 text-ui">
        <span class="flex-1">{c.label}</span>
        <span class="font-mono text-meta {ok ? 'text-muted-foreground' : 'text-warning'}">{c.ratio.toFixed(1)} : 1</span>
        {#if ok}<CheckIcon class="text-success size-3.5" aria-label={t("ausreichend")} />{:else}<TriangleAlertIcon class="text-warning size-3.5" aria-label={t("unter {min} : 1", { min: c.min })} />{/if}
      </div>
    {/each}
  </SettingsSection>

  <SettingsSection title={t("Einzelne Farben ({mode})", { mode: modeName })}>
    <SettingRow label={t("Farben einzeln festlegen")} description={t("Überschreibt die abgeleiteten Werte exakt; ohne Kontrast-Garantie.")}>
      <Switch on={advanced} label={t("Farben einzeln festlegen")} onclick={() => (advanced = !advanced)} />
    </SettingRow>
    {#if advanced}
      {#each TOKENS as name (name)}
        <div class="flex items-center gap-2 px-2 py-1 text-ui">
          <span class="flex-1 font-mono text-meta {overrides[name] ? 'text-foreground' : 'text-muted-foreground'}">--{name}</span>
          {#if overrides[name]}
            <IconButton
              size="md"
              label={t("{name} zurücksetzen", { name })}
              onclick={() => editTheme((x) => delete (theme.dark ? x.overrides.dark : x.overrides.light)[name])}><RotateCcwIcon class="size-3.5" /></IconButton
            >
          {/if}
          <ColorPicker value={tokens[name]} label={name} onchange={(v) => editTheme((x) => ((theme.dark ? x.overrides.dark : x.overrides.light)[name] = v))} />
        </div>
      {/each}
    {/if}
  </SettingsSection>
</div>
