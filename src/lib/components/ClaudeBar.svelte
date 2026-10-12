<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import PlugIcon from "@lucide/svelte/icons/plug";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import { Select } from "$lib/components/kit";
  import { MODES } from "$lib/claudemode";

  // Steuert claude im Terminal: Slash-Commands gehen ueber die open-claude-Mod (claude_command), der Modus per Umschalt+Tab.
  // mode: aus der Terminal-Fusszeile (Terminal.svelte), undefined bis claude sie zeigt
  let { id, mode, onsettings }: { id: string; mode?: string; onsettings: () => void } = $props();

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
    const p = await invoke<{ model: string; effort: string | null } | null>("claude_panel", { id }).catch(() => null);
    if (!p) return;
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
  async function pickMode(target: string) {
    if (cycling) return;
    cycling = true;
    for (let i = 0; mode !== target && i < MODES.length; i++) {
      await invoke("pty_write", { id, data: "\x1b[Z" }).catch((e) => (error = String(e)));
      await sleep(250);
    }
    cycling = false;
  }
</script>

<!-- Logo kommt aus static/logo.svg; eigenes Logo: Datei ersetzen. -->
<!-- Schmal: Knoepfe nur mit Icon, Logo kleiner; Name steht im title -->
<!-- Aussen p-2 wie Terminal, damit die Karte genauso breit ist -->
<header class="@container shrink-0 px-2 pt-2">
  <div class="bg-card ring-foreground/5 flex items-center gap-3 rounded-xl px-3 py-1.5 shadow-lg ring-1 shadow-black/10">
  <img src="/logo.svg" alt="Logo" class="h-8 shrink-0 select-none @3xl:h-10" draggable="false" />
  <div class="text-muted-foreground ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs">
    <Select
      value={mode ?? ""}
      options={MODES}
      onchange={pickMode}
      placeholder="Modus"
      class={mode === "bypassPermissions" ? "border-destructive/60 text-destructive" : ""}
      title="Berechtigungsmodus (Umschalt+Tab im Terminal)"
      aria-label="Berechtigungsmodus"
    />
    <button
      type="button"
      class="border-border hover:text-foreground flex h-6 items-center gap-1 rounded border px-1.5"
      title="MCP-Server (/mcp)"
      onclick={mcp}><PlugIcon class="size-3" /><span class="hidden @3xl:inline">MCP</span></button
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
    <button
      type="button"
      class="border-border hover:text-foreground flex h-6 items-center gap-1 rounded border px-1.5"
      title="Fast-Modus an/aus (/fast): schnellere Antworten, kostet mehr"
      onclick={() => run("fast")}><ZapIcon class="size-3" /><span class="hidden @3xl:inline">Fast</span></button
    >
    <button
      type="button"
      class="border-border hover:text-foreground flex h-6 items-center gap-1 rounded border px-1.5"
      title="Claude-Einstellungen"
      onclick={onsettings}><SettingsIcon class="size-3" /><span class="hidden @3xl:inline">Einstellungen</span></button
    >
    {#if error}<span class="text-destructive truncate" title={error}>{error}</span>{/if}
  </div>
  </div>
</header>
