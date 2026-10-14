<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open as pickFolder } from "@tauri-apps/plugin-dialog";
  import FolderSearchIcon from "@lucide/svelte/icons/folder-search";
  import FolderInputIcon from "@lucide/svelte/icons/folder-input";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { FolderField } from "$lib/components/kit";

  // first: Erststart, nicht wegklickbar, eine der beiden Wahlen muss fallen. onchoose("") = ohne Dev-Ordner.
  let {
    open,
    root,
    first,
    onchoose,
    onclose,
  }: { open: boolean; root: string; first: boolean; onchoose: (root: string) => void; onclose: () => void } = $props();

  let mode = $state<"dev" | "single">("dev");
  let path = $state("");
  // Vorschau des Scans: Anzahl gefundener Repos oder Fehler; null = laeuft noch.
  let found = $state<number | null>(null);
  let error = $state("");

  $effect(() => {
    if (!open) return;
    path = root;
    mode = root || first ? "dev" : "single";
  });

  // Nur der juengste Scan zaehlt; kurz warten, damit nicht jeder Tastendruck scannt.
  let gen = 0;
  $effect(() => {
    const p = path.trim();
    const g = ++gen;
    found = null;
    error = "";
    if (!open || !p) return;
    const t = setTimeout(async () => {
      try {
        const n = (await invoke<unknown[]>("scan", { root: p, extra: [] })).length;
        if (g === gen) found = n;
      } catch (e) {
        if (g === gen) error = String(e);
      }
    }, 300);
    return () => clearTimeout(t);
  });

  async function browse() {
    const picked = await pickFolder({ directory: true, defaultPath: path || undefined });
    if (typeof picked === "string") (path = picked), (mode = "dev");
  }

  const ready = $derived(mode === "single" || (!!path.trim() && found !== null && !error));
  const submit = () => ready && onchoose(mode === "dev" ? path.trim() : "");
</script>

{#snippet option(id: "dev" | "single", Icon: typeof FolderSearchIcon, title: string, text: string)}
  <button
    class="flex w-full items-start gap-3 rounded-lg p-3 text-left ring-1 transition-colors {mode === id
      ? 'bg-primary/5 ring-primary/60'
      : 'ring-border hover:bg-accent/40'}"
    aria-pressed={mode === id}
    onclick={() => (mode = id)}
  >
    <Icon class="mt-0.5 size-4 shrink-0 {mode === id ? 'text-primary' : 'text-muted-foreground'}" />
    <span class="min-w-0">
      <span class="block text-sm font-medium">{title}</span>
      <span class="text-muted-foreground block text-xs">{text}</span>
    </span>
  </button>
{/snippet}

<Dialog.Root {open} onOpenChange={(o) => !o && !first && onclose()}>
  <Dialog.Content
    class="sm:max-w-md"
    showCloseButton={!first}
    escapeKeydownBehavior={first ? "ignore" : "close"}
    interactOutsideBehavior={first ? "ignore" : "close"}
  >
    <Dialog.Header>
      <Dialog.Title>{first ? "Willkommen bei Open Claude" : "Projektquelle"}</Dialog.Title>
      <Dialog.Description>Wie sollen deine Projekte in die Liste kommen? Ändern geht später jederzeit.</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-2">
      {@render option("dev", FolderSearchIcon, "Dev-Ordner", "Alle Git-Repos darunter erscheinen automatisch.")}
      {#if mode === "dev"}
        <!-- Enter im Pfadfeld uebernimmt; kein form, sonst waere der Ordner-Knopf ein Submit. -->
        <div class="grid gap-1.5 pl-1" role="presentation" onkeydown={(e) => e.key === "Enter" && submit()}>
          <FolderField bind:value={path} oninput={() => {}} onbrowse={browse} />
          <p class="min-h-4 text-[11px] {error ? 'text-destructive' : 'text-muted-foreground'}">
            {#if error}{error}
            {:else if !path.trim()}Ordner wählen oder Pfad eingeben.
            {:else if found === null}Suche Repos …
            {:else if found === 0}Noch keine Git-Repos darin, neue erscheinen nach dem Klonen.
            {:else}{found} {found === 1 ? "Git-Repo" : "Git-Repos"} gefunden.{/if}
          </p>
        </div>
      {/if}
      {@render option("single", FolderInputIcon, "Ohne Dev-Ordner", "Projekte einzeln hinzufügen, egal wo sie liegen.")}
    </div>

    <div class="flex justify-end">
      <Button onclick={submit} disabled={!ready}>Übernehmen</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
