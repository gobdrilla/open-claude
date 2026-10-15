<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { editor, setCustom, setRun } from "$lib/editor.svelte";
  import { run } from "$lib/run.svelte";

  let { open = $bindable(false), repo }: { open: boolean; repo: string } = $props();

  const s = $derived(editor(repo));
  let name = $state("");
  let dir = $state("");
  let command = $state("");

  // Name ist die gespeicherte Auswahl: darf mit keinem erkannten oder eigenen Ziel kollidieren.
  const taken = $derived([...run(repo).configs.map((c) => c.label), ...s.custom.map((c) => c.name)].includes(name.trim()));
  const badDir = $derived(/^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$)/.test(dir.trim()));
  const error = $derived(taken ? "Name gibt es schon" : badDir ? "Ordner relativ zum Projekt, ohne .." : "");

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
      <Dialog.Title>Eigene Startziele</Dialog.Title>
      <Dialog.Description
        >Ein beliebiger Befehl, der in der Login-Shell wie im Terminal läuft, z. B. <code>npm run tauri dev</code> oder
        <code>docker compose up</code>. Gilt für dieses Projekt.</Dialog.Description
      >
    </Dialog.Header>

    {#if s.custom.length}
      <ul class="border-border divide-border divide-y rounded border text-xs">
        {#each s.custom as c (c.name)}
          <li class="flex items-center gap-2 px-2.5 py-1.5">
            <span class="font-medium">{c.name}</span>
            <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]" title={c.command}
              >{c.dir ? `${c.dir}: ` : ""}{c.command}</span
            >
            <Button
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:text-destructive size-6"
              title="Startziel {c.name} löschen"
              aria-label="Startziel {c.name} löschen"
              onclick={() => setCustom(repo, s.custom.filter((x) => x.name !== c.name))}><TrashIcon class="size-3.5" /></Button
            >
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex flex-col gap-2">
      <Input bind:value={name} placeholder="Name, z. B. App starten" class="text-xs" onkeydown={enter} />
      <Input bind:value={command} placeholder="Befehl, z. B. npm run tauri dev" class="font-mono text-xs" onkeydown={enter} />
      <Input bind:value={dir} placeholder="Ordner (optional, relativ zum Projekt)" class="font-mono text-xs" onkeydown={enter} />
      {#if error}<p class="text-destructive text-xs">{error}</p>{/if}
      <Button size="sm" class="text-xs" disabled={!name.trim() || !command.trim() || !!error} onclick={add}>Startziel anlegen</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
