<script lang="ts">
  import { Button, Dialog, IconButton, Input } from "$lib/atelier-ui";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { editor, setCustom, setRun } from "$lib/editor.svelte";
  import { run } from "$lib/run.svelte";
  import { t } from "$lib/i18n";

  let { open = $bindable(false), repo }: { open: boolean; repo: string } = $props();

  const s = $derived(editor(repo));
  let name = $state("");
  let dir = $state("");
  let command = $state("");

  // Name ist die gespeicherte Auswahl: darf mit keinem erkannten oder eigenen Ziel kollidieren.
  const taken = $derived([...run(repo).configs.map((c) => c.label), ...s.custom.map((c) => c.name)].includes(name.trim()));
  const badDir = $derived(/^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$)/.test(dir.trim()));
  const error = $derived(taken ? t("Name gibt es schon") : badDir ? t("Ordner relativ zum Projekt, ohne ..") : "");

  const enter = (e: KeyboardEvent) => e.key === "Enter" && add();

  function add() {
    if (!name.trim() || !command.trim() || error) return;
    const n = name.trim();
    setCustom(repo, [...s.custom, { name: n, dir: dir.trim().replace(/\\/g, "/").replace(/^\.\/|\/+$/g, ""), command: command.trim() }]);
    setRun(repo, n);
    name = dir = command = "";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{t("Eigene Startziele")}</Dialog.Title>
      <!-- {0}, {1}: the code samples, so the sentence stays whole for translation -->
      <Dialog.Description
        >{#each t("Ein beliebiger Befehl, der in der Login-Shell wie im Terminal läuft, z. B. {0} oder {1}. Gilt für dieses Projekt.").split(/\{(\d)\}/) as part, i (i)}{#if i % 2}<code
              >{["npm run tauri dev", "docker compose up"][+part]}</code
            >{:else}{part}{/if}{/each}</Dialog.Description
      >
    </Dialog.Header>

    {#if s.custom.length}
      <ul class="border-border divide-border divide-y rounded border text-ui">
        {#each s.custom as c (c.name)}
          <li class="flex items-center gap-2 px-2.5 py-1.5">
            <span class="font-medium">{c.name}</span>
            <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-meta" title={c.command}
              >{c.dir ? `${c.dir}: ` : ""}{c.command}</span
            >
            <IconButton
              size="md"
              tone="danger"
              label={t("Startziel {name} löschen", { name: c.name })}
              onclick={() => setCustom(repo, s.custom.filter((x) => x.name !== c.name))}><TrashIcon class="size-3.5" /></IconButton
            >
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex flex-col gap-2">
      <Input bind:value={name} placeholder={t("Name, z. B. App starten")} density="sm" onkeydown={enter} />
      <Input bind:value={command} placeholder={t("Befehl, z. B. npm run tauri dev")} density="sm" class="font-mono" onkeydown={enter} />
      <Input bind:value={dir} placeholder={t("Ordner (optional, relativ zum Projekt)")} density="sm" class="font-mono" onkeydown={enter} />
      {#if error}<p class="text-destructive text-ui">{error}</p>{/if}
      <Button size="sm" disabled={!name.trim() || !command.trim() || !!error} onclick={add}>{t("Startziel anlegen")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
