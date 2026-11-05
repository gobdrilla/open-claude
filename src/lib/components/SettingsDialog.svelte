<script lang="ts">
  import { Button, ConfirmBar, Dialog, IconButton, Input, Row, Segmented, SettingRow, SettingsSection, Slider, Switch, TextButton } from "$lib/atelier-ui";
  import type { Update } from "@tauri-apps/plugin-updater";
  import { langPref, setLangPref, t, type LangPref } from "$lib/i18n";
  import { ASKS, noAsk, setNoAsk, type AskKey } from "$lib/ask.svelte";
  import { gitCmds, setGitCmds } from "$lib/gitcmds.svelte";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { prefs, toggleAi, togglePref } from "$lib/editor.svelte";
  import { readClaude, setClaude, type ClaudeCfg } from "$lib/claudeSettings";
  import { ZOOM_MAX, ZOOM_MIN } from "$lib/zoom";
  import { Asker } from "$lib/confirm.svelte";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import BotIcon from "@lucide/svelte/icons/bot";
  import InfoIcon from "@lucide/svelte/icons/info";
  import PuzzleIcon from "@lucide/svelte/icons/puzzle";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import ExtensionsTab from "./ExtensionsTab.svelte";
  import ThemeTab from "./theme/ThemeTab.svelte";

  // App settings; state and side effects stay in +page.svelte. Sub-dialogs replace this one (openSub there),
  // questions show as a bar inside it.
  let {
    open = $bindable(false),
    amongUs = $bindable(),
    mac,
    version,
    update,
    checking,
    updating,
    autostart,
    tray,
    lidAwake,
    zoom,
    onautostart,
    ontray,
    onlidawake,
    onzoom,
    onamongus,
    oncheckupdate,
    oninstall,
    onclaude,
    onclaudeaccounts,
    onprofiles,
    ongitaccounts,
    onhelp,
  }: {
    open: boolean;
    amongUs: { on: boolean; rate: number; volume: number };
    mac: boolean;
    version: string;
    update: Update | null;
    checking: boolean;
    updating: boolean;
    autostart: boolean;
    tray: boolean;
    lidAwake: boolean;
    zoom: number;
    onautostart: () => void;
    ontray: () => void;
    onlidawake: (ask: Asker["ask"]) => void;
    onzoom: (dir: number) => void;
    onamongus: () => void;
    /** Resolves to the message to show (up to date or error). */
    oncheckupdate: () => Promise<string>;
    oninstall: (ask: Asker["ask"]) => void;
    onclaude: () => void;
    onclaudeaccounts: () => void;
    onprofiles: () => void;
    ongitaccounts: () => void;
    onhelp: () => void;
  } = $props();

  const TABS = [
    [t("Allgemein"), "general", SettingsIcon],
    ["Themes", "themes", PaletteIcon],
    ["Terminal", "terminal", TerminalIcon],
    ["Git", "git", GitBranchIcon],
    ["Claude", "claude", BotIcon],
    [t("Erweiterungen"), "extensions", PuzzleIcon],
    ["Info", "info", InfoIcon],
  ] as const;
  let tab = $state<(typeof TABS)[number][1]>("general");
  let lang = $state<LangPref>(langPref);
  const RATES: [string, number][] = [[t("Selten"), 3], ["Normal", 1], [t("Oft"), 0.4]];
  const mod = $derived(mac ? "⌘" : t("Strg"));

  // Terminal theme lives in ~/.claude/settings.json; reread on entering the tab (the Claude dialog may have changed it).
  let claudeCfg = $state<ClaudeCfg | null>(null);
  const loadClaudeCfg = () => readClaude().then((c) => (claudeCfg = c), () => (claudeCfg = null));
  async function setClaudeCfg(key: string, value: unknown) {
    try {
      claudeCfg = await setClaude(key, value);
    } catch {
      loadClaudeCfg();
    }
  }
  $effect(() => {
    if (open && tab === "terminal") loadClaudeCfg();
  });

  // New custom Git command (Settings › Git).
  let cmdName = $state("");
  let cmdText = $state("");
  const cmdTaken = $derived(gitCmds.some((c) => c.name === cmdName.trim()));
  function addCmd() {
    if (!cmdName.trim() || !cmdText.trim() || cmdTaken) return;
    setGitCmds([...gitCmds, { name: cmdName.trim(), command: cmdText.trim() }]);
    cmdName = cmdText = "";
  }
  const cmdEnter = (e: KeyboardEvent) => e.key === "Enter" && addCmd();

  // Rueckfragen (Deckel wach, Update) als Leiste hier drin. Gilt nur fuer den Reiter, in dem sie gestellt wurde.
  const asker = new Asker();
  $effect(() => {
    void tab;
    void open;
    return () => asker.q?.done(false);
  });

  let updateMsg = $state("");
  $effect(() => {
    if (!open) updateMsg = "";
  });
  async function checkNow() {
    updateMsg = await oncheckupdate();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[560px] max-h-full gap-0 overflow-hidden p-0 sm:max-w-[880px]">
    <nav class="bg-background/60 border-border flex w-52 shrink-0 flex-col gap-0.5 border-r px-2.5 py-4">
      <Dialog.Title class="text-title mx-2 mb-3">{t("Einstellungen")}</Dialog.Title>
      {#each TABS as [label, key, Icon] (key)}
        <Row text="md" density="roomy" class="gap-2.5" active={tab === key} aria-current={tab === key ? "page" : undefined} onclick={() => (tab = key)}>
          <Icon class="size-4" />{label}
        </Row>
      {/each}
      {#if version}<span class="text-muted-foreground text-meta mt-auto px-2.5 font-mono">v{version}</span>{/if}
    </nav>

    <div class="flex min-w-0 flex-1 flex-col">
      <h3 class="border-border text-title flex h-13 shrink-0 items-center border-b px-7">{TABS.find((t) => t[1] === tab)?.[0]}</h3>
      <div class="flex-1 space-y-5 overflow-y-auto px-7 py-5">
        <ConfirmBar {asker} />
        {#if tab === "general"}
          <SettingsSection title={t("Start und Fenster")}>
            <!-- macOS: Autostart ueber die Systemeinstellungen. -->
            {#if !mac}
              <SettingRow label="Autostart" description={t("L'Atelier beim Anmelden am System starten.")}>
                <Switch label="Autostart" on={autostart} onclick={onautostart} />
              </SettingRow>
            {/if}
            <SettingRow
              label={mac ? t("Schließen legt in die Menüleiste") : t("Schließen legt ins Tray")}
              description={t("Das Fenster verschwindet, laufende Sitzungen bleiben aktiv. Aus: Schließen beendet die App.")}
            >
              <Switch label={t("Schließen legt ins Tray")} on={tray} onclick={ontray} />
            </SettingRow>
            <SettingRow label={t("Zugeklappt wach, solange Claude arbeitet")} description={t("Der Laptop schläft beim Zuklappen erst ein, wenn Claude fertig ist.")}>
              <Switch label={t("Zugeklappt wach")} on={lidAwake} onclick={() => onlidawake(asker.ask)} />
            </SettingRow>
          </SettingsSection>
          <SettingsSection title="Editor">
            <SettingRow label={t("KI-Vorschläge im Editor")} description={t("Graue Vervollständigung beim Tippen, Tab übernimmt.")}>
              <Switch label={t("KI-Vorschläge im Editor")} on={prefs.ai} onclick={toggleAi} />
            </SettingRow>
            <SettingRow label={t("Git-Blame in der aktuellen Zeile")} description={t("Autor, Alter und Commit hinter der Cursorzeile; Klick zeigt den Commit im Verlauf.")}>
              <Switch label={t("Git-Blame in der aktuellen Zeile")} on={prefs.blame} onclick={() => togglePref("blame")} />
            </SettingRow>
            <SettingRow label={t("Inlay-Hinweise")} description={t("Typen und Parameternamen grau im Code, vom Language-Server.")}>
              <Switch label={t("Inlay-Hinweise")} on={prefs.inlay} onclick={() => togglePref("inlay")} />
            </SettingRow>
            <SettingRow label="Code Vision" description={t("Verwendungen und Implementierungen über Klassen und Methoden, vom Language-Server; Klick zeigt sie.")}>
              <Switch label="Code Vision" on={prefs.lens} onclick={() => togglePref("lens")} />
            </SettingRow>
            <SettingRow label={t("Beim Speichern formatieren")} description={t("{mod}+S formatiert die Datei vorher über den Language-Server.", { mod })}>
              <Switch label={t("Beim Speichern formatieren")} on={prefs.format} onclick={() => togglePref("format")} />
            </SettingRow>
          </SettingsSection>
          <SettingsSection title={t("Darstellung")}>
            <SettingRow label="Zoom" description={t("Gilt für alle Ansichten. Auch mit {mod} + / − / 0.", { mod })}>
              <div class="bg-secondary flex items-center rounded p-0.5">
                <IconButton size="text" disabled={zoom <= ZOOM_MIN} onclick={() => onzoom(-1)} label={t("Verkleinern")} title={t("Verkleinern ({mod} −)", { mod })}
                  >−</IconButton
                >
                <TextButton tone="plain" size="sm" class="w-11 justify-center py-0.5 tabular-nums" onclick={() => onzoom(0)} title={t("Zurücksetzen ({mod} 0)", { mod })}
                  >{zoom} %</TextButton
                >
                <IconButton size="text" disabled={zoom >= ZOOM_MAX} onclick={() => onzoom(1)} label={t("Vergrößern")} title={t("Vergrößern ({mod} +)", { mod })}
                  >+</IconButton
                >
              </div>
            </SettingRow>
            <!-- Fixed per run (i18n.ts): a change shows a note until the next start. -->
            <SettingRow label="Sprache / Language" description={t("System folgt der Sprache des Betriebssystems.")}>
              <Segmented value={lang} options={[["System", "system"], ["Deutsch", "de"], ["English", "en"]] as const} onchange={(v: LangPref) => (setLangPref(v), (lang = v))} />
            </SettingRow>
            {#if lang !== langPref}
              <p class="text-warning px-1 text-meta">
                {t("Gilt nach einem Neustart der App.")}
              </p>
            {/if}
          </SettingsSection>
        {:else if tab === "themes"}
          <ThemeTab />
        {:else if tab === "terminal"}
          {#if claudeCfg}
            <SettingsSection title={t("Claude (neue Sitzungen)")}>
              <SettingRow label={t("Terminal-Theme")} description={t("Auto wechselt Hell/Dunkel live mit der App, Lila erst in neuen Sitzungen.")}>
                <Segmented
                  value={String(claudeCfg.theme ?? "dark").startsWith("custom:atelier:atelier")
                    ? "custom:atelier:atelier"
                    : claudeCfg.theme === "auto"
                      ? "auto"
                      : ""}
                  options={[[t("Std"), "", t("Standard von Claude Code oder ein anderes Theme aus den Claude-Einstellungen")], ["Auto", "auto"], [t("Lila"), "custom:atelier:atelier"]] as const}
                  onchange={(v) => setClaudeCfg("theme", v || undefined)}
                />
              </SettingRow>
            </SettingsSection>
          {/if}
          <SettingsSection title={t("Easteregg")}>
            <SettingRow label={t("Among-Us-Easteregg")} description={t("Rührst du Maus und Tastatur eine Weile nicht an, laufen Figuren durchs Bild.")}>
              <Switch label={t("Among-Us-Easteregg")} on={amongUs.on} onclick={() => ((amongUs.on = !amongUs.on), onamongus())} />
            </SettingRow>
            {#if amongUs.on}
              <SettingRow label={t("Häufigkeit")}>
                <Segmented value={amongUs.rate} options={RATES} onchange={(rate) => ((amongUs.rate = rate), onamongus())} />
              </SettingRow>
              <SettingRow label="Sound">
                <Slider min="0" max="1" step="0.05" aria-label={t("Easteregg-Lautstärke")} bind:value={amongUs.volume} onchange={onamongus} />
              </SettingRow>
            {/if}
          </SettingsSection>
        {:else if tab === "git"}
          <SettingsSection title={t("Rückfrage vor")}>
            {#each Object.entries(ASKS) as [key, label] (key)}
              <SettingRow {label}>
                <Switch label={t("Rückfrage vor {label}", { label })} on={!noAsk[key]} onclick={() => setNoAsk(key as AskKey, !noAsk[key])} />
              </SettingRow>
            {/each}
          </SettingsSection>
          <SettingsSection title={t("Konten")}>
            <SettingRow label={t("Git-Konten")} description={t("GitHub- und GitLab-Zugänge für Klonen, Push/Pull und Pull Requests.")}>
              <Button variant="outline" size="sm" onclick={ongitaccounts}>{t("Verwalten")}</Button>
            </SettingRow>
          </SettingsSection>
          <SettingsSection title={t("Eigene Befehle")}>
            {#each gitCmds as c (c.name)}
              <SettingRow label={c.name} description={c.command}>
                <IconButton
                  size="md"
                  tone="danger"
                  label={t("Befehl {name} löschen", { name: c.name })}
                  onclick={() => setGitCmds(gitCmds.filter((x) => x.name !== c.name))}><TrashIcon class="size-3.5" /></IconButton
                >
              </SettingRow>
            {/each}
            <SettingRow
              label={t("Neuer Befehl")}
              description={t('Läuft im Projektordner (Login-Shell, unter Windows PowerShell). Variablen: $REPO, $SHA, $BRANCH, $FILE – Pfade in Anführungszeichen, z. B. code "$FILE".')}
            >
              <div class="flex w-56 shrink-0 flex-col gap-1.5">
                <Input bind:value={cmdName} density="sm" placeholder={t("Name, z. B. In VS Code öffnen")} onkeydown={cmdEnter} />
                <Input bind:value={cmdText} density="sm" class="font-mono" placeholder="git log -1 $SHA" onkeydown={cmdEnter} />
                {#if cmdTaken}<p class="text-destructive text-meta">{t("Name gibt es schon")}</p>{/if}
                <Button variant="outline" size="sm" disabled={!cmdName.trim() || !cmdText.trim() || cmdTaken} onclick={addCmd}
                  >{t("Hinzufügen")}</Button
                >
              </div>
            </SettingRow>
          </SettingsSection>
        {:else if tab === "claude"}
          <SettingsSection title="Claude Code">
            <SettingRow label={t("Claude-Einstellungen")} description={t("Modell, Berechtigungen und Darstellung wie /config im Terminal.")}>
              <Button variant="outline" size="sm" onclick={onclaude}>{t("Öffnen")}</Button>
            </SettingRow>
            <SettingRow label={t("Claude-Konten")} description={t("An- und abmelden, zwischen gemerkten Konten wechseln.")}>
              <Button variant="outline" size="sm" onclick={onclaudeaccounts}>{t("Verwalten")}</Button>
            </SettingRow>
            <SettingRow label={t("Skill-Profile")} description={t("Vorlagen für Skills und Plugins je Projekttyp oder Projekt.")}>
              <Button variant="outline" size="sm" onclick={onprofiles}>{t("Bearbeiten")}</Button>
            </SettingRow>
          </SettingsSection>
        {:else if tab === "extensions"}
          <ExtensionsTab />
        {:else}
          <SettingsSection title="L'Atelier de Claude">
            <SettingRow
              label={version ? t("Version {version}", { version }) : t("Version")}
              description={checking ? t("Suche nach Updates …") : update ? t("Update {version} verfügbar.", { version: update.version }) : updateMsg || undefined}
            >
              {#if update}
                <Button size="sm" disabled={updating} onclick={() => oninstall(asker.ask)}>{updating ? t("Aktualisiere…") : t("Installieren und neu starten")}</Button>
              {:else}
                <Button variant="outline" size="sm" disabled={checking} onclick={checkNow}>{t("Nach Updates suchen")}</Button>
              {/if}
            </SettingRow>
            <SettingRow label={t("Tastenkürzel")} description={t("Alles lässt sich ohne Maus bedienen. Auch mit F1.")}>
              <Button variant="outline" size="sm" onclick={onhelp}>{t("Anzeigen")}</Button>
            </SettingRow>
          </SettingsSection>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
