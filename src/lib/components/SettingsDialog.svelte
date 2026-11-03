<script lang="ts">
  import { Button, ConfirmBar, Dialog, IconButton, Row, Segmented, SettingRow, SettingsSection, Slider, Switch, TextButton } from "$lib/atelier-ui";
  import type { Update } from "@tauri-apps/plugin-updater";
  import { theme, setMode } from "$lib/theme.svelte";
  import { ASKS, noAsk, setNoAsk, type AskKey } from "$lib/ask.svelte";
  import { prefs, toggleAi } from "$lib/editor.svelte";
  import { readClaude, setClaude, type ClaudeCfg } from "$lib/claudeSettings";
  import { ZOOM_MAX, ZOOM_MIN } from "$lib/zoom";
  import { Asker } from "$lib/confirm.svelte";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import BotIcon from "@lucide/svelte/icons/bot";
  import InfoIcon from "@lucide/svelte/icons/info";

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
    ["Allgemein", "general", SettingsIcon],
    ["Terminal", "terminal", TerminalIcon],
    ["Git", "git", GitBranchIcon],
    ["Claude", "claude", BotIcon],
    ["Info", "info", InfoIcon],
  ] as const;
  let tab = $state<(typeof TABS)[number][1]>("general");
  const RATES: [string, number][] = [["Selten", 3], ["Normal", 1], ["Oft", 0.4]];
  const mod = $derived(mac ? "⌘" : "Strg");

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
      <Dialog.Title class="text-title mx-2 mb-3">Einstellungen</Dialog.Title>
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
          <SettingsSection title="Start und Fenster">
            <!-- macOS: Autostart ueber die Systemeinstellungen. -->
            {#if !mac}
              <SettingRow label="Autostart" description="L'Atelier beim Anmelden am System starten.">
                <Switch label="Autostart" on={autostart} onclick={onautostart} />
              </SettingRow>
            {/if}
            <SettingRow
              label={mac ? "Schließen legt in die Menüleiste" : "Schließen legt ins Tray"}
              description="Das Fenster verschwindet, laufende Sitzungen bleiben aktiv. Aus: Schließen beendet die App."
            >
              <Switch label="Schließen legt ins Tray" on={tray} onclick={ontray} />
            </SettingRow>
            <SettingRow label="Zugeklappt wach, solange Claude arbeitet" description="Der Laptop schläft beim Zuklappen erst ein, wenn Claude fertig ist.">
              <Switch label="Zugeklappt wach" on={lidAwake} onclick={() => onlidawake(asker.ask)} />
            </SettingRow>
            <SettingRow label="KI-Vorschläge im Editor" description="Graue Vervollständigung beim Tippen, Tab übernimmt.">
              <Switch label="KI-Vorschläge im Editor" on={prefs.ai} onclick={toggleAi} />
            </SettingRow>
          </SettingsSection>
          <SettingsSection title="Darstellung">
            <SettingRow label="Zoom" description="Gilt für alle Ansichten. Auch mit {mod} + / − / 0.">
              <div class="bg-secondary flex items-center rounded p-0.5">
                <IconButton size="text" disabled={zoom <= ZOOM_MIN} onclick={() => onzoom(-1)} label="Verkleinern" title="Verkleinern ({mod} −)"
                  >−</IconButton
                >
                <TextButton tone="plain" size="sm" class="w-11 justify-center py-0.5 tabular-nums" onclick={() => onzoom(0)} title="Zurücksetzen ({mod} 0)"
                  >{zoom} %</TextButton
                >
                <IconButton size="text" disabled={zoom >= ZOOM_MAX} onclick={() => onzoom(1)} label="Vergrößern" title="Vergrößern ({mod} +)"
                  >+</IconButton
                >
              </div>
            </SettingRow>
            <SettingRow label="Design" description="Hell, dunkel oder wie das System.">
              <Segmented value={theme.mode} options={[["System", "system"], ["Hell", "light"], ["Dunkel", "dark"]] as const} onchange={setMode} />
            </SettingRow>
          </SettingsSection>
        {:else if tab === "terminal"}
          {#if claudeCfg}
            <SettingsSection title="Claude (neue Sitzungen)">
              <SettingRow label="Terminal-Theme" description="Auto wechselt Hell/Dunkel live mit der App, Lila erst in neuen Sitzungen.">
                <Segmented
                  value={String(claudeCfg.theme ?? "dark").startsWith("custom:open-claude:open-claude")
                    ? "custom:open-claude:open-claude"
                    : claudeCfg.theme === "auto"
                      ? "auto"
                      : ""}
                  options={[["Std", "", "Standard von Claude Code oder ein anderes Theme aus den Claude-Einstellungen"], ["Auto", "auto"], ["Lila", "custom:open-claude:open-claude"]] as const}
                  onchange={(v) => setClaudeCfg("theme", v || undefined)}
                />
              </SettingRow>
            </SettingsSection>
          {/if}
          <SettingsSection title="Easteregg">
            <SettingRow label="Among-Us-Easteregg" description="Rührst du Maus und Tastatur eine Weile nicht an, laufen Figuren durchs Bild.">
              <Switch label="Among-Us-Easteregg" on={amongUs.on} onclick={() => ((amongUs.on = !amongUs.on), onamongus())} />
            </SettingRow>
            {#if amongUs.on}
              <SettingRow label="Häufigkeit">
                <Segmented value={amongUs.rate} options={RATES} onchange={(rate) => ((amongUs.rate = rate), onamongus())} />
              </SettingRow>
              <SettingRow label="Sound">
                <Slider min="0" max="1" step="0.05" aria-label="Easteregg-Lautstärke" bind:value={amongUs.volume} onchange={onamongus} />
              </SettingRow>
            {/if}
          </SettingsSection>
        {:else if tab === "git"}
          <SettingsSection title="Rückfrage vor">
            {#each Object.entries(ASKS) as [key, label] (key)}
              <SettingRow {label}>
                <Switch label="Rückfrage vor {label}" on={!noAsk[key]} onclick={() => setNoAsk(key as AskKey, !noAsk[key])} />
              </SettingRow>
            {/each}
          </SettingsSection>
          <SettingsSection title="Konten">
            <SettingRow label="Git-Konten" description="GitHub- und GitLab-Zugänge für Klonen, Push/Pull und Pull Requests.">
              <Button variant="outline" size="sm" onclick={ongitaccounts}>Verwalten</Button>
            </SettingRow>
          </SettingsSection>
        {:else if tab === "claude"}
          <SettingsSection title="Claude Code">
            <SettingRow label="Claude-Einstellungen" description="Modell, Berechtigungen und Darstellung wie /config im Terminal.">
              <Button variant="outline" size="sm" onclick={onclaude}>Öffnen</Button>
            </SettingRow>
            <SettingRow label="Claude-Konten" description="An- und abmelden, zwischen gemerkten Konten wechseln.">
              <Button variant="outline" size="sm" onclick={onclaudeaccounts}>Verwalten</Button>
            </SettingRow>
            <SettingRow label="Skill-Profile" description="Vorlagen für Skills und Plugins je Projekttyp oder Projekt.">
              <Button variant="outline" size="sm" onclick={onprofiles}>Bearbeiten</Button>
            </SettingRow>
          </SettingsSection>
        {:else}
          <SettingsSection title="L'Atelier de Claude">
            <SettingRow
              label={version ? `Version ${version}` : "Version"}
              description={checking ? "Suche nach Updates …" : update ? `Update ${update.version} verfügbar.` : updateMsg || undefined}
            >
              {#if update}
                <Button size="sm" disabled={updating} onclick={() => oninstall(asker.ask)}>{updating ? "Aktualisiere…" : "Installieren und neu starten"}</Button>
              {:else}
                <Button variant="outline" size="sm" disabled={checking} onclick={checkNow}>Nach Updates suchen</Button>
              {/if}
            </SettingRow>
            <SettingRow label="Tastenkürzel" description="Alles lässt sich ohne Maus bedienen. Auch mit F1.">
              <Button variant="outline" size="sm" onclick={onhelp}>Anzeigen</Button>
            </SettingRow>
          </SettingsSection>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
