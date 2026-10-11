<script lang="ts" module>
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
      title: "Modell & Denken",
      fields: [
        { k: "model", label: "Modell", type: "text", placeholder: "Standard (empfohlen)", list: ["opus", "opus[1m]", "sonnet", "sonnet[1m]", "haiku", "fable", "opusplan"] },
        {
          k: "effortLevel",
          label: "Effort",
          hint: "Wie gründlich Claude nachdenkt",
          type: "enum",
          def: "",
          opts: [["Standard", ""], ["Niedrig", "low"], ["Mittel", "medium"], ["Hoch", "high"], ["Sehr hoch", "xhigh"], ["Maximal", "max"]],
        },
        { k: "alwaysThinkingEnabled", label: "Thinking-Modus", hint: "Erweitertes Nachdenken standardmäßig an", type: "bool", def: true },
        { k: "outputStyle", label: "Ausgabestil", type: "text", placeholder: "default", list: ["default", "Explanatory", "Learning"] },
        { k: "language", label: "Sprache", hint: "Antwortsprache, z. B. german oder de", type: "text", placeholder: "Standard (Englisch)" },
      ],
    },
    {
      title: "Berechtigungen",
      fields: [
        { k: "useAutoModeDuringPlan", label: "Auto-Modus beim Planen", type: "bool", def: true },
        { k: "autoContinueAtUsageLimit", label: "Am Nutzungslimit automatisch weitermachen", type: "bool", def: true },
      ],
    },
    {
      title: "Darstellung",
      fields: [
        {
          k: "theme",
          label: "Theme",
          hint: "Eigene Themes über /theme",
          type: "enum",
          def: "dark",
          opts: [["Dunkel", "dark"], ["Hell", "light"], ["Dunkel (farbenblind)", "dark-daltonized"], ["Hell (farbenblind)", "light-daltonized"], ["Dunkel (ANSI)", "dark-ansi"], ["Hell (ANSI)", "light-ansi"]],
        },
        { k: "editorMode", label: "Editor-Modus", type: "enum", def: "normal", opts: [["Normal", "normal"], ["Vim", "vim"]] },
        { k: "timeFormat", label: "Zeitformat", type: "enum", def: "auto", opts: [["Auto", "auto"], ["12 h", "12h"], ["24 h", "24h"]] },
        { k: "defaultView", label: "Standardansicht", type: "enum", def: "", opts: [["Standard", ""], ["Chat", "chat"], ["Transkript", "transcript"]] },
        { k: "prefersReducedMotion", label: "Weniger Animationen", type: "bool", def: false },
        { k: "spinnerTipsEnabled", label: "Tipps anzeigen", type: "bool", def: true },
        { k: "showTurnDuration", label: "Dauer je Antwort anzeigen", type: "bool", def: true, g: true },
        { k: "showMessageTimestamps", label: "Zeitstempel an Nachrichten", type: "bool", def: false, g: true },
        { k: "terminalProgressBarEnabled", label: "Fortschrittsbalken im Terminal", type: "bool", def: true, g: true },
      ],
    },
    {
      title: "Verhalten",
      fields: [
        { k: "autoCompactEnabled", label: "Auto-Compact", hint: "Kontext automatisch zusammenfassen, wenn er voll wird", type: "bool", def: true, g: true },
        { k: "precomputeCompactionEnabled", label: "Compact vorberechnen", type: "bool", def: true },
        { k: "fileCheckpointingEnabled", label: "Code zurückspulen (Checkpoints)", type: "bool", def: true, g: true },
        { k: "respectGitignore", label: ".gitignore in der Dateiauswahl beachten", type: "bool", def: true, g: true },
        { k: "enableWorkflows", label: "Dynamische Workflows", type: "bool", def: true },
        { k: "workflowKeywordTriggerEnabled", label: "Ultracode-Stichwort startet Workflows", type: "bool", def: true },
        { k: "worktree.baseRef", label: "Worktree-Basis", hint: "Frisch vom Default-Branch oder vom aktuellen HEAD", type: "enum", def: "fresh", opts: [["Frisch", "fresh"], ["HEAD", "head"]] },
        { k: "cleanupPeriodDays", label: "Transkripte behalten (Tage)", type: "number", def: 30 },
        { k: "autoUpdatesChannel", label: "Update-Kanal", type: "enum", def: "latest", opts: [["Neueste", "latest"], ["Stabil", "stable"]] },
      ],
    },
    {
      title: "Benachrichtigungen",
      fields: [
        {
          k: "preferredNotifChannel",
          label: "Lokale Benachrichtigungen",
          type: "enum",
          def: "auto",
          g: true,
          opts: [["Auto", "auto"], ["iTerm2", "iterm2"], ["iTerm2 + Glocke", "iterm2_with_bell"], ["Terminal-Glocke", "terminal_bell"], ["Kitty", "kitty"], ["Ghostty", "ghostty"], ["Aus", "notifications_disabled"]],
        },
        { k: "agentPushNotifEnabled", label: "Push, wenn Claude es für nötig hält", type: "bool", def: false },
        { k: "inputNeededNotifEnabled", label: "Push, wenn eine Aktion nötig ist", type: "bool", def: false },
      ],
    },
    {
      title: "IDE & Terminal",
      fields: [
        { k: "autoConnectIde", label: "Automatisch mit IDE verbinden", type: "bool", def: false, g: true },
        { k: "autoInstallIdeExtension", label: "IDE-Erweiterung automatisch installieren", type: "bool", def: true, g: true },
        { k: "diffTool", label: "Diff-Anzeige", type: "enum", def: "auto", g: true, opts: [["Auto", "auto"], ["Terminal", "terminal"]] },
        { k: "copyOnSelect", label: "Beim Markieren kopieren", type: "bool", def: true, g: true },
        { k: "copyFullResponse", label: "/copy ohne Auswahl", type: "bool", def: false, g: true },
      ],
    },
  ];
  const RULES = [
    ["allow", "Erlauben"],
    ["ask", "Nachfragen"],
    ["deny", "Verbieten"],
  ] as const;
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Segmented, Select, Switch } from "$lib/components/kit";
  import { MODES } from "$lib/chat.logic";
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

  async function load() {
    error = "";
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

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Claude-Einstellungen</Dialog.Title>
      <Dialog.Description>Wie /config im Terminal. Gilt für neue Sitzungen; Umschalt+Tab im Chat wechselt den Modus sofort.</Dialog.Description>
    </Dialog.Header>

    <div class="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 text-xs">
      {#each SECTIONS as s (s.title)}
        <section>
          <h3 class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase">{s.title}</h3>
          <div class="border-border/60 divide-y divide-foreground/5 rounded-lg border">
            {#if s.title === "Berechtigungen"}
              {@render row("Standard-Modus", "Mit welchem Modus neue Sitzungen starten", modeCtl)}
            {/if}
            {#each s.fields as f (f.k)}
              {@render row(f.label, f.hint, ctl, f)}
            {/each}
            {#if s.title === "Berechtigungen"}
              {#each RULES as [k, label] (k)}
                <div class="px-2 py-1.5">
                  <div class="mb-1 flex items-center gap-2">
                    <span class="flex-1">{label}</span>
                    <span class="text-muted-foreground tabular-nums">{rules(k).length}</span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    {#each rules(k) as r (r)}
                      <span class="bg-secondary flex items-center gap-1 rounded py-0.5 pr-0.5 pl-1.5 font-mono text-[11px]"
                        >{r}<button class="hover:text-destructive text-muted-foreground" aria-label="{r} entfernen" disabled={!parsed} onclick={() => setRules(k, rules(k).filter((x) => x !== r))}
                          ><XIcon class="size-3" /></button
                        ></span
                      >
                    {/each}
                    <Input
                      bind:value={adding[k]}
                      disabled={!parsed}
                      placeholder={k === "deny" ? "z. B. Bash(rm -rf:*)" : "z. B. Bash(npm test:*)"}
                      class="h-6 w-48 font-mono text-[11px] md:text-[11px]"
                      onkeydown={(e) => e.key === "Enter" && addRule(k)}
                      onblur={() => addRule(k)}
                    />
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </section>
      {/each}

      <details>
        <summary class="text-muted-foreground cursor-pointer text-[11px] font-medium tracking-wide uppercase">settings.json direkt bearbeiten</summary>
        <Textarea bind:value={text} spellcheck={false} class="mt-1.5 h-64 font-mono text-[11px] md:text-[11px]" placeholder={"{}"} />
      </details>
    </div>

    {#if !parsed}<p class="text-destructive text-xs">settings.json ist kein gültiges JSON-Objekt</p>{/if}
    {#if error}<p class="text-destructive text-xs">{error}</p>{/if}

    <div class="flex gap-1.5">
      <Button variant="outline" size="sm" class="text-xs" disabled={busy} onclick={load}>Neu laden</Button>
      <Button size="sm" class="flex-1 text-xs" disabled={busy || !parsed || (text === loaded && !globDirty)} onclick={save}>Speichern</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

{#snippet row(label: string, hint: string | undefined, control: import("svelte").Snippet<[Field]>, f: Field = modeField)}
  <div class="flex min-h-9 items-center gap-3 px-2 py-1.5">
    <div class="min-w-0 flex-1">
      <div>{label}</div>
      {#if hint}<div class="text-muted-foreground text-[11px]">{hint}</div>{/if}
    </div>
    {@render control(f)}
  </div>
{/snippet}

{#snippet modeCtl(_: Field)}
  <Segmented value={mode} options={MODES} onchange={(v) => set(modeField, v)} disabled={!parsed} />
{/snippet}

{#snippet ctl(f: Field)}
  {@const off = !f.g && !parsed}
  {#if f.type === "bool"}
    <Switch on={!!shown(f)} label={f.label} disabled={off} onclick={() => set(f, !shown(f))} />
  {:else if f.type === "enum"}
    {@const v = String(shown(f))}
    <!-- Unbekannter Wert (z. B. eigenes Theme) bleibt waehlbar statt still ueberschrieben -->
    <Select value={v} options={f.opts.some(([, o]) => o === v) ? f.opts : [...f.opts, [v, v] as const]} onchange={(x) => set(f, x)} disabled={off} aria-label={f.label} />
  {:else if f.type === "number"}
    <Input
      type="number"
      min="1"
      value={String(shown(f))}
      disabled={off}
      class="h-7 w-20 text-xs md:text-xs"
      onchange={(e) => {
        const n = Math.round(Number(e.currentTarget.value));
        set(f, Number.isFinite(n) && n > 0 ? n : undefined);
      }}
    />
  {:else}
    <Input
      value={String(get(f) ?? "")}
      list={f.list ? `cs-${f.k}` : undefined}
      disabled={off}
      placeholder={f.placeholder}
      class="h-7 w-48 font-mono text-xs md:text-xs"
      onchange={(e) => set(f, e.currentTarget.value.trim())}
    />
    {#if f.list}<datalist id="cs-{f.k}">{#each f.list as o (o)}<option value={o}></option>{/each}</datalist>{/if}
  {/if}
{/snippet}
