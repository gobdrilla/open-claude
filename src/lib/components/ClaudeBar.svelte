<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import PlugIcon from "@lucide/svelte/icons/plug";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import Share2Icon from "@lucide/svelte/icons/share-2";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { Button, Select } from "$lib/atelier-ui";
  import { MODES } from "$lib/claudemode";

  // Steuert claude im Terminal: Slash-Commands gehen ueber die open-claude-Mod (claude_command), der Modus per Umschalt+Tab.
  // mode: aus der Terminal-Fusszeile (Terminal.svelte), undefined bis claude sie zeigt
  // guest: claude runs at the host, so only the view actions on the right are shown.
  // share/onnew: missing = not offered for this session (guest, group).
  let {
    id,
    mode,
    guest = false,
    side,
    ontoggleside,
    share,
    onnew,
    onsettings,
  }: {
    id: string;
    mode?: string;
    guest?: boolean;
    side: boolean;
    ontoggleside: () => void;
    share?: { on: boolean; guests: number; open: () => void };
    onnew?: () => void;
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

<!-- Logo kommt aus static/logo.svg; eigenes Logo: Datei ersetzen. -->
<!-- Schmal: Knoepfe nur mit Icon, Logo kleiner; Name steht im title -->
<!-- Aussen p-2 wie Terminal, damit die Karte genauso breit ist -->
<header class="@container shrink-0 px-2 pt-2">
  <div class="bg-card glow ring-foreground/5 flex items-center gap-3 rounded-xl px-3 py-1.5 shadow-lg ring-1 shadow-black/10">
  <img src="/logo.svg" alt="Logo" class="h-8 shrink-0 select-none @3xl:h-10" draggable="false" />
  <div class="text-muted-foreground ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs">
    {#if !guest}
    <Select
      value={mode ?? ""}
      options={MODES}
      onchange={pickMode}
      placeholder="Modus"
      class={mode === "bypassPermissions" ? "border-destructive/60 text-destructive" : ""}
      title="Berechtigungsmodus (Umschalt+Tab im Terminal)"
      aria-label="Berechtigungsmodus"
    />
    <Button variant="outline" size="xs" class="px-1.5 font-normal" title="MCP-Server (/mcp)" onclick={mcp}
      ><PlugIcon class="size-3" /><span class="hidden @3xl:inline">MCP</span></Button
    >
    <Select
      value={model}
      options={MODELS}
      onchange={(v) => ((model = v), run("model", v))}
      placeholder="Modell"
      title="Modell für diese Sitzung (/model)"
      aria-label="Modell"
    />
    <Select
      value={effort}
      options={EFFORT}
      onchange={(v) => ((effort = v), run("effort", v))}
      placeholder="Effort"
      title="Wie gründlich Claude nachdenkt (/effort)"
      aria-label="Effort"
    />
    <Button variant="outline" size="xs" class="px-1.5 font-normal" title="Claude-Einstellungen" onclick={onsettings}
      ><SettingsIcon class="size-3" /><span class="hidden @3xl:inline">Einstellungen</span></Button
    >
    {/if}
    <div class="bg-border mx-1 h-4 w-px"></div>
    {#if share}
      <Button
        variant="quiet"
        size="xs"
        class="gap-1.5 {share.on ? 'text-primary hover:text-primary' : ''}"
        onclick={share.open}
        title="Sitzung mit anderen teilen"
        ><Share2Icon class="size-3.5" /> Teilen{#if share.guests}&nbsp;({share.guests}){/if}</Button
      >
    {/if}
    <Button variant="toggle" size="xs" class="gap-1.5" aria-pressed={side} onclick={ontoggleside} title="Sitzung, Workflows und Bilder"
      ><WorkflowIcon class="size-3.5" /> Aktivität</Button
    >
    {#if onnew}
      <Button variant="quiet" size="xs" class="gap-1.5" onclick={onnew} title="Weitere Claude-Sitzung im selben Projekt"
        ><PlusIcon class="size-3.5" /> Sitzung</Button
      >
    {/if}
    {#if error}<span class="text-destructive truncate" title={error}>{error}</span>{/if}
  </div>
  </div>
</header>
