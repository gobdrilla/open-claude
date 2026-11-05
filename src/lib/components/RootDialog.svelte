<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open as pickFolder } from "@tauri-apps/plugin-dialog";
  import FolderSearchIcon from "@lucide/svelte/icons/folder-search";
  import FolderInputIcon from "@lucide/svelte/icons/folder-input";
  import { Button, Dialog, FolderField, Row } from "$lib/atelier-ui";
  import { t } from "$lib/i18n";

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
    const timer = setTimeout(async () => {
      try {
        const n = (await invoke<unknown[]>("scan", { root: p, extra: [] })).length;
        if (g === gen) found = n;
      } catch (e) {
        if (g === gen) error = String(e);
      }
    }, 300);
    return () => clearTimeout(timer);
  });

  async function browse() {
    const picked = await pickFolder({ directory: true, title: t("Ordner wählen"), defaultPath: path || undefined });
    if (typeof picked === "string") (path = picked), (mode = "dev");
  }

  const ready = $derived(mode === "single" || (!!path.trim() && found !== null && !error));
  const submit = () => ready && onchoose(mode === "dev" ? path.trim() : "");
</script>

{#snippet option(id: "dev" | "single", Icon: typeof FolderSearchIcon, title: string, text: string)}
  <Row
    variant="card"
    selected={mode === id}
    class="flex-row items-start gap-3 p-3 text-body"
    aria-pressed={mode === id}
    onclick={() => (mode = id)}
  >
    <Icon class="mt-0.5 size-4 shrink-0 {mode === id ? 'text-primary' : 'text-muted-foreground'}" />
    <span class="min-w-0">
      <span class="block text-body font-medium">{title}</span>
      <span class="text-muted-foreground block text-ui">{text}</span>
    </span>
  </Row>
{/snippet}

<Dialog.Root {open} onOpenChange={(o) => !o && !first && onclose()}>
  <Dialog.Content
    class="sm:max-w-md"
    showCloseButton={!first}
    escapeKeydownBehavior={first ? "ignore" : "close"}
    interactOutsideBehavior={first ? "ignore" : "close"}
  >
    <Dialog.Header>
      <Dialog.Title>{first ? t("Willkommen bei L'Atelier de Claude") : t("Projektquelle")}</Dialog.Title>
      <Dialog.Description>{t("Wie sollen deine Projekte in die Liste kommen? Ändern geht später jederzeit.")}</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-2">
      {@render option("dev", FolderSearchIcon, t("Dev-Ordner"), t("Alle Git-Repos darunter erscheinen automatisch."))}
      {#if mode === "dev"}
        <!-- Enter im Pfadfeld uebernimmt; kein form, sonst waere der Ordner-Knopf ein Submit. -->
        <div class="grid gap-1.5 pl-1" role="presentation" onkeydown={(e) => e.key === "Enter" && submit()}>
          <FolderField bind:value={path} oninput={() => {}} onbrowse={browse} />
          <p class="min-h-4 text-meta {error ? 'text-destructive' : 'text-muted-foreground'}">
            {#if error}{error}
            {:else if !path.trim()}{t("Ordner wählen oder Pfad eingeben.")}
            {:else if found === null}{t("Suche Repos …")}
            {:else if found === 0}{t("Noch keine Git-Repos darin, neue erscheinen nach dem Klonen.")}
            {:else}{found === 1 ? t("1 Git-Repo gefunden.") : t("{n} Git-Repos gefunden.", { n: found })}{/if}
          </p>
        </div>
      {/if}
      {@render option("single", FolderInputIcon, t("Ohne Dev-Ordner"), t("Projekte einzeln hinzufügen, egal wo sie liegen."))}
    </div>

    <div class="flex justify-end gap-2">
      {#if !first}<Button variant="ghost" size="sm" onclick={onclose}>{t("Abbrechen")}</Button>{/if}
      <Button size="sm" onclick={submit} disabled={!ready}>{t("Übernehmen")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
