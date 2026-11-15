<script lang="ts">
  import { Button, IconButton, Input, Segmented, Select, SettingRow, SettingsSection, Slider, Switch, TextButton, Textarea } from "$lib/atelier-ui";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { theme, setMode } from "$lib/theme.svelte";
  import { t } from "$lib/i18n";
  import { css } from "$lib/color";
  import { CODE_SCHEMES, GLOW_AT, PRESETS, REFS, derive, gradientCss, isPreset, refColor, type CodeScheme, type Theme } from "$lib/themes";
  import { copyTheme, current, deleteTheme, editTheme, exportTheme, importTheme, newTheme, selectTheme, themeEditor, themes } from "$lib/themes.svelte";
  import { GLOW_LABELS, REF_LABELS, SCHEME_LABELS } from "./labels";
  import GradientEditor from "./GradientEditor.svelte";

  // onclose: closes the settings dialog, so the editor beside the app is not covered.
  let { onclose }: { onclose?: () => void } = $props();

  const th = $derived(current());
  const preset = $derived(isPreset(th.id));
  const all = $derived([...PRESETS, ...themes.own]);

  function adjust() {
    themeEditor.open = true;
    onclose?.();
  }

  /** Card preview: background, backdrop gradient and accent dot of the theme in the current mode. */
  function look(x: Theme) {
    const tk = derive(x, theme.dark);
    const bg = x.backdrop.on ? `${gradientCss(x.backdrop.gradient, true, (r) => css(refColor(tk, r)))}, ` : "";
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
    note = x ? t("„{name}“ importiert.", { name: x.name }) : t("Kein gültiges Theme (JSON mit \"version\": 1 oder 2).");
    if (x) importing = false;
  }
  async function doExport() {
    await navigator.clipboard.writeText(exportTheme()).then(
      () => (note = t("Theme als JSON in die Zwischenablage kopiert.")),
      () => (note = t("Zwischenablage nicht verfügbar.")),
    );
  }
</script>

<div class="flex flex-col gap-6">
  <SettingsSection title={t("Theme")}>
    <div class="grid grid-cols-3 gap-2 p-2">
      {#each all as x (x.id)}
        {@const l = look(x)}
        <TextButton
          tone="plain"
          class="ring-foreground/10 hover:ring-foreground/25 flex h-16 flex-col items-stretch justify-between overflow-hidden rounded-lg p-2 ring-1 {x.id === th.id ? 'ring-ring! ring-2' : ''}"
          style="background: {l.bg}"
          aria-pressed={x.id === th.id}
          onclick={() => ((note = ""), selectTheme(x.id))}
        >
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full" style:background={l.dot}></span>
            <span class="h-1.5 w-8 rounded-full" style:background={l.card}></span>
          </span>
          <span class="text-ui truncate font-medium" style:color={l.fg}>{x.name}</span>
        </TextButton>
      {/each}
      <TextButton
        tone="plain"
        class="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 flex h-16 items-center justify-center gap-1.5 rounded-lg border border-dashed"
        onclick={() => ((note = ""), newTheme())}><PlusIcon class="size-3.5" />{t("Neues Theme")}</TextButton
      >
    </div>
    <SettingRow label={t("Modus")} description={t("Hell, dunkel oder wie das System. Jedes Theme hat beide Varianten.")}>
      <Segmented value={theme.mode} options={[["System", "system"], [t("Hell"), "light"], [t("Dunkel"), "dark"]] as const} onchange={setMode} />
    </SettingRow>
    <div class="flex flex-wrap items-center gap-2 px-2 py-2">
      {#if !preset}
        <Input
          density="sm"
          class="w-44"
          aria-label={t("Name")}
          maxlength={40}
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
    <SettingRow label={t("Farben anpassen")} description={t("Öffnet den Editor neben der App: jede Farbe einzeln, für Hell und Dunkel. Jede Änderung siehst du sofort in der echten Oberfläche.")}>
      <Button size="sm" onclick={adjust}><PaletteIcon class="size-3.5" />{t("Anpassen")}</Button>
    </SettingRow>
    <SettingRow label={t("Editor-Farbschema")} description={t("Farben für Code im Editor, unabhängig vom Theme.")}>
      <Select value={th.code} options={CODE_SCHEMES.map((s) => [SCHEME_LABELS[s], s] as const)} aria-label={t("Editor-Farbschema")} onchange={(v) => editTheme((x) => (x.code = v as CodeScheme))} />
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
</div>
