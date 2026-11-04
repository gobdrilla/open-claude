<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import PlugIcon from "@lucide/svelte/icons/plug";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import Share2Icon from "@lucide/svelte/icons/share-2";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import { Button, Select } from "$lib/atelier-ui";
  import { MODES } from "$lib/claudemode";

  // Steuert claude im Terminal: Slash-Commands gehen ueber die atelier-Mod (claude_command), der Modus per Umschalt+Tab.
  // mode: aus der Terminal-Fusszeile (Terminal.svelte), undefined bis claude sie zeigt
  // guest: claude runs at the host, so only the view actions on the right are shown.
  // share/onnew/onskills: missing = not offered for this session (guest, group, no project).
  let {
    id,
    mode,
    footerEffort,
    guest = false,
    side,
    ontoggleside,
    share,
    onnew,
    onskills,
    onsettings,
  }: {
    id: string;
    mode?: string;
    /** Denk-Stufe aus der Terminal-Fusszeile; gilt, bis die Mod sie selbst meldet. */
    footerEffort?: string;
    guest?: boolean;
    side: boolean;
    ontoggleside: () => void;
    share?: { on: boolean; guests: number; open: () => void };
    onnew?: () => void;
    onskills?: () => void;
    onsettings: () => void;
  } = $props();

  const MODELS = [
    ["Fable", "fable"],
    ["Opus", "opus"],
    ["Sonnet", "sonnet"],
    ["Haiku", "haiku"],
  ] as const;
  const EFFORT = [
    ["Niedrig", "low"],
    ["Mittel", "medium"],
    ["Hoch", "high"],
    ["Sehr hoch", "xhigh"],
    ["Max", "max"],
  ] as const;

  let model = $state("");
  let effort = $state("");
  let error = $state("");

  // Aktueller Stand aus dem Session-Panel der Mod; Modell kommt als voller Name (claude-opus-5-5[1m]).
  // Effort hat in der Mod keinen Getter, er kommt erst mit dem ersten turn.step; bis dahin zeigt Denken „Standard“.
  async function poll() {
    const i = id;
    if (guest) return;
    const p = await invoke<{ model: string; effort: string | null } | null>("claude_panel", { id: i }).catch(() => null);
    // Tab inzwischen gewechselt: Antwort gehoert zur alten Sitzung.
    if (!p || i !== id) return;
    model = MODELS.find(([, v]) => p.model.includes(v))?.[1] ?? "";
    effort = p.effort ?? "";
  }
  onMount(() => {
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  });
  $effect(() => {
    void id;
    model = effort = error = "";
    poll();
  });

  const run = (command: string, args = "") =>
    invoke<number>("claude_command", { id, command, args }).then(
      (at) => ((error = ""), at),
      (e) => ((error = String(e)), 0),
    );
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const panelOf = () => invoke<{ filled?: number } | null>("claude_panel", { id }).catch(() => null);

  // Die Mod setzt /mcp nur ins leere Eingabefeld und meldet das per filled; dann hier Enter.
  async function mcp() {
    const at = await run("mcp");
    for (let i = 0; at && i < 20; i++) {
      await sleep(150);
      if ((await panelOf())?.filled === at) return invoke("pty_write", { id, data: "\r" });
    }
  }

  // Ein Modus laesst sich nur per Umschalt+Tab weiterschalten: so oft, bis die Fusszeile ihn zeigt.
  let cycling = false;
  const cycleTo = async (target: string) => {
    for (let i = 0; mode !== target && i < MODES.length; i++) {
      await invoke("pty_write", { id, data: "\x1b[Z" }).catch((e) => (error = String(e)));
      await sleep(250);
    }
  };
  async function pickMode(target: string) {
    if (cycling) return;
    cycling = true;
    const start = mode;
    await cycleTo(target);
    // Nicht im Zyklus (z. B. Alles erlauben ohne --dangerously-skip-permissions): nicht still woanders stehen bleiben.
    if (mode !== target) {
      error = `Modus „${MODES.find(([, v]) => v === target)?.[0] ?? target}“ ist in dieser Sitzung nicht wählbar`;
      if (start) await cycleTo(start);
    }
    cycling = false;
  }
</script>

<!-- Logo kommt aus static/logo.png; eigenes Logo: Datei ersetzen. -->
<!-- Compact h-9 bar, always one line; on narrow widths the view actions on the right drop their labels (tooltip keeps the name). -->
<header class="border-border text-ui flex min-h-9 shrink-0 items-center gap-1.5 border-b px-2.5 py-1">
  <img src="/logo.png" alt="Claude" title="Claude" class="mr-1 size-4 shrink-0 select-none [image-rendering:pixelated]" draggable="false" />
  {#if !guest}
    <Select
      label="Modus"
      value={mode ?? ""}
      options={MODES}
      onchange={pickMode}
      placeholder="–"
      class={mode === "bypassPermissions" ? "border-destructive/60 text-destructive" : ""}
      title="Berechtigungsmodus (Umschalt+Tab im Terminal)"
      aria-label="Berechtigungsmodus"
    />
    <Select
      label="Modell"
      value={model}
      options={MODELS}
      onchange={(v) => ((model = v), run("model", v))}
      placeholder="–"
      title="Modell für diese Sitzung (/model)"
      aria-label="Modell"
    />
    <Select
      label="Denken"
      value={effort || footerEffort || ""}
      options={EFFORT}
      onchange={(v) => ((effort = v), run("effort", v))}
      placeholder="Standard"
      title="Wie gründlich Claude nachdenkt (/effort)"
      aria-label="Denken"
    />
    <Button variant="outline" size="xs" class="gap-1.5 font-normal" title="MCP-Server (/mcp)" onclick={mcp}
      ><PlugIcon class="size-3" /> MCP</Button
    >
    {#if onskills}
      <Button variant="outline" size="xs" class="gap-1.5 font-normal" title="Skills und Plugins dieses Projekts" onclick={onskills}
        ><SparklesIcon class="size-3" /> Skills</Button
      >
    {/if}
  {/if}
  <div class="ml-auto flex min-w-0 items-center gap-1.5">
    {#if error}<span class="text-destructive min-w-0 truncate" title={error}>{error}</span>{/if}
    {#if share}
      <Button
        variant="quiet"
        size="xs"
        class="gap-1.5 {share.on ? 'text-primary hover:text-primary' : ''}"
        onclick={share.open}
        title="Sitzung mit anderen teilen"
        ><Share2Icon class="size-3.5" /> <span class="max-lg:hidden">Teilen</span>{#if share.guests}&nbsp;({share.guests}){/if}</Button
      >
    {/if}
    <Button variant="toggle" size="xs" class="gap-1.5" aria-pressed={side} onclick={ontoggleside} title="Aktivität: Sitzung, Workflows und Bilder"
      ><WorkflowIcon class="size-3.5" /> <span class="max-lg:hidden">Aktivität</span></Button
    >
    {#if onnew}
      <Button variant="quiet" size="xs" class="gap-1.5" onclick={onnew} title="Weitere Claude-Sitzung im selben Projekt"
        ><PlusIcon class="size-3.5" /> <span class="max-lg:hidden">Sitzung</span></Button
      >
    {/if}
    {#if !guest}
      <Button variant="quiet" size="xs" class="gap-1.5" title="Claude-Einstellungen" onclick={onsettings}
        ><SettingsIcon class="size-3.5" /> <span class="max-lg:hidden">Einstellungen</span></Button
      >
    {/if}
  </div>
</header>
