<script lang="ts" module>
  import { t } from "$lib/i18n";
  // Optionen wie in /config von Claude Code (Stand 2.1.x). g = liegt in ~/.claude.json statt settings.json.
  // def = Standard von Claude Code; wer ihn waehlt, loescht den Key, damit spaetere Standardwechsel greifen.
  type Opt = readonly [label: string, value: string];
  type Field = { k: string; label: string; hint?: string; g?: true } & (
    | { type: "bool"; def: boolean }
    | { type: "enum"; def: string; opts: readonly Opt[] }
    | { type: "text"; placeholder: string; list?: readonly string[] }
    | { type: "number"; def: number }
  );

  const SECTIONS: { title: string; fields: Field[] }[] = [
    {
      title: t("Modell & Denken"),
      fields: [
        { k: "model", label: t("Modell"), type: "text", placeholder: t("Standard (empfohlen)"), list: ["opus", "opus[1m]", "sonnet", "sonnet[1m]", "haiku", "fable", "opusplan"] },
        {
          k: "effortLevel",
          label: t("Denken"),
          hint: t("Wie gründlich Claude nachdenkt"),
          type: "enum",
          def: "",
          opts: [[t("Standard"), ""], [t("Niedrig"), "low"], [t("Mittel"), "medium"], [t("Hoch"), "high"], [t("Sehr hoch"), "xhigh"], ["Max", "max"]],
        },
        { k: "alwaysThinkingEnabled", label: t("Erweitertes Denken"), hint: t("Erweitertes Nachdenken standardmäßig an"), type: "bool", def: true },
        { k: "outputStyle", label: t("Ausgabestil"), type: "text", placeholder: t("Standard"), list: ["default", "Explanatory", "Learning"] },
        { k: "language", label: t("Sprache"), hint: t("Antwortsprache, z. B. german oder de"), type: "text", placeholder: t("Standard (Englisch)") },
      ],
    },
    {
      title: t("Berechtigungen"),
      fields: [
        { k: "useAutoModeDuringPlan", label: t("Auto-Modus beim Planen"), type: "bool", def: true },
        { k: "autoContinueAtUsageLimit", label: t("Am Nutzungslimit automatisch weitermachen"), type: "bool", def: true },
      ],
    },
    {
      title: t("Darstellung"),
      fields: [
        {
          k: "theme",
          label: "Theme",
          hint: t("Auto wechselt live mit der App, Atelier erst in neuen Sitzungen"),
          type: "enum",
          def: "dark",
          opts: [[t("Auto (live mit der App)"), "auto"], [t("Atelier (lila)"), "custom:atelier:atelier"], [t("Dunkel"), "dark"], [t("Hell"), "light"], [t("Dunkel (farbenblind)"), "dark-daltonized"], [t("Hell (farbenblind)"), "light-daltonized"], [t("Dunkel (ANSI)"), "dark-ansi"], [t("Hell (ANSI)"), "light-ansi"]],
        },
        { k: "editorMode", label: t("Editor-Modus"), type: "enum", def: "normal", opts: [["Normal", "normal"], ["Vim", "vim"]] },
        { k: "timeFormat", label: t("Zeitformat"), type: "enum", def: "auto", opts: [["Auto", "auto"], ["12 h", "12h"], ["24 h", "24h"]] },
        { k: "defaultView", label: t("Standardansicht"), type: "enum", def: "", opts: [[t("Standard"), ""], ["Chat", "chat"], [t("Transkript"), "transcript"]] },
        { k: "prefersReducedMotion", label: t("Weniger Animationen"), type: "bool", def: false },
        { k: "spinnerTipsEnabled", label: t("Tipps anzeigen"), type: "bool", def: true },
        { k: "showTurnDuration", label: t("Dauer je Antwort anzeigen"), type: "bool", def: true, g: true },
        { k: "showMessageTimestamps", label: t("Zeitstempel an Nachrichten"), type: "bool", def: false, g: true },
        { k: "terminalProgressBarEnabled", label: t("Fortschrittsbalken im Terminal"), type: "bool", def: true, g: true },
      ],
    },
    {
      title: t("Verhalten"),
      fields: [
        { k: "autoCompactEnabled", label: "Auto-Compact", hint: t("Kontext automatisch zusammenfassen, wenn er voll wird"), type: "bool", def: true, g: true },
        { k: "precomputeCompactionEnabled", label: t("Compact vorberechnen"), type: "bool", def: true },
        { k: "fileCheckpointingEnabled", label: t("Code zurückspulen (Checkpoints)"), type: "bool", def: true, g: true },
        { k: "respectGitignore", label: t(".gitignore in der Dateiauswahl beachten"), type: "bool", def: true, g: true },
        { k: "enableWorkflows", label: t("Dynamische Workflows"), type: "bool", def: true },
        { k: "workflowKeywordTriggerEnabled", label: t("Ultracode-Stichwort startet Workflows"), type: "bool", def: true },
        { k: "worktree.baseRef", label: t("Worktree-Basis"), hint: t("Frisch vom Default-Branch oder vom aktuellen HEAD"), type: "enum", def: "fresh", opts: [[t("Frisch"), "fresh"], ["HEAD", "head"]] },
        { k: "cleanupPeriodDays", label: t("Transkripte behalten (Tage)"), type: "number", def: 30 },
        { k: "autoUpdatesChannel", label: t("Update-Kanal"), type: "enum", def: "latest", opts: [[t("Neueste"), "latest"], [t("Stabil"), "stable"]] },
      ],
    },
    {
      title: t("Benachrichtigungen"),
      fields: [
        {
          k: "preferredNotifChannel",
          label: t("Lokale Benachrichtigungen"),
          type: "enum",
          def: "auto",
          g: true,
          opts: [["Auto", "auto"], ["iTerm2", "iterm2"], [t("iTerm2 + Glocke"), "iterm2_with_bell"], [t("Terminal-Glocke"), "terminal_bell"], ["Kitty", "kitty"], ["Ghostty", "ghostty"], [t("Aus"), "notifications_disabled"]],
        },
        { k: "agentPushNotifEnabled", label: t("Push, wenn Claude es für nötig hält"), type: "bool", def: false },
        { k: "inputNeededNotifEnabled", label: t("Push, wenn eine Aktion nötig ist"), type: "bool", def: false },
      ],
    },
    {
      title: "IDE & Terminal",
      fields: [
        { k: "autoConnectIde", label: t("Automatisch mit IDE verbinden"), type: "bool", def: false, g: true },
        { k: "autoInstallIdeExtension", label: t("IDE-Erweiterung automatisch installieren"), type: "bool", def: true, g: true },
        { k: "diffTool", label: t("Diff-Anzeige"), type: "enum", def: "auto", g: true, opts: [["Auto", "auto"], ["Terminal", "terminal"]] },
        { k: "copyOnSelect", label: t("Beim Markieren kopieren"), type: "bool", def: true, g: true },
        { k: "copyFullResponse", label: t("/copy ohne Auswahl"), type: "bool", def: false, g: true },
      ],
    },
  ];
  const RULES = [
    ["allow", t("Erlauben")],
    ["ask", t("Nachfragen")],
    ["deny", t("Verbieten")],
  ] as const;
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button, Dialog, IconButton, Input, Segmented, Select, SettingRow, SettingsSection, Switch, Textarea } from "$lib/atelier-ui";
  const MODES = [
    [t("Manuell"), "default", t("Fragt vor Änderungen und Befehlen")],
    [t("Edits annehmen"), "acceptEdits", t("Dateiänderungen ohne Rückfrage")],
    [t("Plan"), "plan", t("Nur lesen und planen")],
    ["Auto", "auto", t("Claude entscheidet, was sicher ist")],
    [t("Nicht fragen"), "dontAsk", t("Nur Erlaubtes, alles andere wird abgelehnt")],
  ] as const;
  import XIcon from "@lucide/svelte/icons/x";

  let { open = $bindable(false) }: { open: boolean } = $props();

  // settings.json: der Text ist die Wahrheit, die Felder sind Abkuerzungen hinein.
  let text = $state("");
  let loaded = $state("");
  // ~/.claude.json: nur die erlaubten Keys, siehe GLOBAL_KEYS im Backend
  let glob = $state<Record<string, unknown>>({});
  let globLoaded = $state<Record<string, unknown>>({});
  let error = $state("");
  let busy = $state(false);
  let adding = $state<Record<string, string>>({});

  const parsed = $derived.by(() => {
    try {
      const v = JSON.parse(text.trim() || "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
    } catch {
      return null;
    }
  });
  const globDirty = $derived(JSON.stringify(glob) !== JSON.stringify(globLoaded));
  const dirty = $derived(text !== loaded || globDirty);
  // Ungespeicherte Aenderungen: die Fusszeile fragt nach, kein Dialog im Dialog. Nochmal Esc bricht die Frage ab.
  let asking = $state<"close" | "reload" | null>(null);
  function close() {
    if (asking) asking = null;
    else if (dirty) asking = "close";
    else open = false;
  }
  function reload() {
    if (dirty) asking = "reload";
    else load();
  }
  function discardNow() {
    const a = asking;
    asking = null;
    if (a === "close") open = false;
    else load();
  }

  async function load() {
    error = "";
    custom = "";
    asking = null;
    try {
      [loaded, globLoaded] = await Promise.all([invoke<string>("claude_settings_read"), invoke<Record<string, unknown>>("claude_global_read")]);
      text = loaded;
      glob = { ...globLoaded };
    } catch (e) {
      error = String(e);
    }
  }

  $effect(() => {
    if (open) load();
  });

  function patch(fn: (s: Record<string, any>) => void) {
    if (!parsed) return;
    const s = $state.snapshot(parsed);
    fn(s);
    text = JSON.stringify(s, null, 2) + "\n";
  }

  // Punkt-Pfade wie worktree.baseRef; leere Elternobjekte fallen beim Loeschen weg.
  function get(f: Field): unknown {
    if (f.g) return glob[f.k];
    return f.k.split(".").reduce<any>((o, p) => o?.[p], parsed);
  }
  const CUSTOM = "__custom__";
  // List field currently edited as free text
  let custom = $state("");
  function set(f: Field, v: unknown) {
    const unset = v === "" || v === undefined || ("def" in f && v === f.def);
    if (f.g) {
      const g = { ...glob };
      if (unset) delete g[f.k];
      else g[f.k] = v;
      glob = g;
      return;
    }
    patch((s) => {
      const path = f.k.split(".");
      const last = path.pop()!;
      const parents: Record<string, any>[] = [s];
      for (const p of path) {
        const o = parents.at(-1)!;
        if (typeof o[p] !== "object" || o[p] === null) {
          if (unset) return;
          o[p] = {};
        }
        parents.push(o[p]);
      }
      if (unset) delete parents.at(-1)![last];
      else parents.at(-1)![last] = v;
      for (let i = path.length - 1; i >= 0; i--) if (!Object.keys(parents[i + 1]).length) delete parents[i][path[i]];
    });
  }
  const shown = (f: Field) => get(f) ?? ("def" in f ? f.def : "");

  const mode = $derived(parsed?.permissions?.defaultMode ?? "default");
  const modeField: Field = { k: "permissions.defaultMode", label: "", type: "enum", def: "default", opts: [] };
  const rules = (k: string): string[] => (Array.isArray(parsed?.permissions?.[k]) ? parsed!.permissions[k] : []);
  function setRules(k: string, list: string[]) {
    patch((s) => {
      s.permissions = { ...s.permissions, [k]: list };
      if (!list.length) delete s.permissions[k];
      if (!Object.keys(s.permissions).length) delete s.permissions;
    });
  }
  function addRule(k: string) {
    const r = adding[k]?.trim();
    if (!r || rules(k).includes(r)) return;
    setRules(k, [...rules(k), r]);
    adding[k] = "";
  }

  async function save() {
    busy = true;
    error = "";
    try {
      if (text !== loaded) await invoke("claude_settings_write", { text, expected: loaded });
      loaded = text;
      if (globDirty) {
        // Nur geaenderte Keys; null loescht
        const keys = new Set([...Object.keys(glob), ...Object.keys(globLoaded)]);
        const values = Object.fromEntries([...keys].filter((k) => glob[k] !== globLoaded[k]).map((k) => [k, glob[k] ?? null]));
        await invoke("claude_global_write", { values });
        globLoaded = { ...glob };
      }
      open = false;
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }
</script>

<Dialog.Root bind:open={() => open, (v) => (v ? (open = true) : void close())}>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{t("Claude-Einstellungen")}</Dialog.Title>
      <Dialog.Description>{t("Wie /config im Terminal. Gilt für neue Sitzungen; Umschalt+Tab im Terminal wechselt den Modus sofort.")}</Dialog.Description>
    </Dialog.Header>

    <div class="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 text-ui">
      {#each SECTIONS as s (s.title)}
        <SettingsSection title={s.title}>
          {#if s.title === t("Berechtigungen")}
            <SettingRow label={t("Standard-Modus")} description={t("Mit welchem Modus neue Sitzungen starten")}>
              <Segmented value={mode} options={MODES} onchange={(v) => set(modeField, v)} disabled={!parsed} />
            </SettingRow>
          {/if}
          {#each s.fields as f (f.k)}
            <SettingRow label={f.label} description={f.hint}>{@render ctl(f)}</SettingRow>
          {/each}
          {#if s.title === t("Berechtigungen")}
            {#each RULES as [k, label] (k)}
              <div class="px-2 py-1.5">
                <div class="mb-1 flex items-center gap-2">
                  <span class="flex-1">{label}</span>
                  <span class="text-muted-foreground tabular-nums">{rules(k).length}</span>
                </div>
                <div class="flex flex-wrap gap-1">
                  {#each rules(k) as r (r)}
                    <span class="bg-secondary flex items-center gap-1 rounded py-0.5 pr-0.5 pl-1.5 font-mono text-meta"
                      >{r}<IconButton size="bare" tone="danger" label={t("{r} entfernen", { r })} disabled={!parsed} onclick={() => setRules(k, rules(k).filter((x) => x !== r))}
                        ><XIcon class="size-3" /></IconButton
                      ></span
                    >
                  {/each}
                  <Input
                    bind:value={adding[k]}
                    disabled={!parsed}
                    placeholder={k === "deny" ? t("z. B. Bash(rm -rf:*)") : t("z. B. Bash(npm test:*)")}
                    density="xs" class="w-48 font-mono"
                    onkeydown={(e) => e.key === "Enter" && addRule(k)}
                    onblur={() => addRule(k)}
                  />
                </div>
              </div>
            {/each}
          {/if}
        </SettingsSection>
      {/each}

      <details>
        <summary class="text-muted-foreground cursor-pointer text-meta font-medium tracking-wide uppercase">{t("settings.json direkt bearbeiten")}</summary>
        <Textarea bind:value={text} spellcheck={false} density="xs" class="mt-1.5 h-64 font-mono" placeholder={"{}"} />
      </details>
    </div>

    {#if !parsed}<p class="text-destructive text-ui">{t("settings.json ist kein gültiges JSON-Objekt")}</p>{/if}
    {#if error}<p class="text-destructive text-ui">{error}</p>{/if}

    <div class="flex items-center justify-end gap-2">
      {#if asking}
        <span class="text-ui mr-auto">{t("Ungespeicherte Änderungen gehen verloren.")}</span>
        <Button variant="ghost" size="sm" onclick={() => (asking = null)}>{t("Zurück")}</Button>
        <Button variant="destructive" size="sm" onclick={discardNow}>{t("Verwerfen")}</Button>
      {:else}
        <Button variant="ghost" size="sm" class="mr-auto" disabled={busy} onclick={reload}>{t("Neu laden")}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onclick={close}>{t("Abbrechen")}</Button>
        <Button size="sm" disabled={busy || !parsed || !dirty} onclick={save}>{t("Speichern")}</Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

{#snippet ctl(f: Field)}
  {@const off = !f.g && !parsed}
  {#if f.type === "bool"}
    <Switch on={!!shown(f)} label={f.label} disabled={off} onclick={() => set(f, !shown(f))} />
  {:else if f.type === "enum"}
    <!-- Hell/Dunkel des Open-Claude-Themes setzt die App je Sitzung selbst (pty::theme_for), darum eine Option -->
    {@const v = String(shown(f)).replace(/^(custom:atelier:atelier)-light$/, "$1")}
    <!-- Unbekannter Wert (z. B. eigenes Theme) bleibt waehlbar statt still ueberschrieben -->
    <Select value={v} options={f.opts.some(([, o]) => o === v) ? f.opts : [...f.opts, [v, v] as const]} onchange={(x) => set(f, x)} disabled={off} aria-label={f.label} />
  {:else if f.type === "number"}
    <Input
      type="number"
      min="1"
      value={String(shown(f))}
      disabled={off}
      density="sm" class="w-20"
      onchange={(e) => {
        const n = Math.round(Number(e.currentTarget.value));
        set(f, Number.isFinite(n) && n > 0 ? n : undefined);
      }}
    />
  {:else if f.list && custom !== f.k}
    {@const v = String(get(f) ?? "")}
    <!-- Unknown value stays selectable; the last entry switches to free text -->
    <Select
      value={v}
      options={[[f.placeholder ?? t("Standard"), ""], ...f.list.map((o) => [o, o] as const), ...(v && !f.list.includes(v) ? [[v, v] as const] : []), [t("Eigener Wert …"), CUSTOM]]}
      onchange={(x) => (x === CUSTOM ? (custom = f.k) : set(f, x))}
      disabled={off}
      aria-label={f.label}
    />
  {:else}
    <Input
      value={String(get(f) ?? "")}
      disabled={off}
      placeholder={f.placeholder}
      density="sm" class="w-48 font-mono"
      onchange={(e) => set(f, e.currentTarget.value.trim())}
    />
  {/if}
{/snippet}
