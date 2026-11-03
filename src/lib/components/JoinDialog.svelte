<script lang="ts">
  import { Button, Dialog, Input } from "$lib/atelier-ui";

  // Geteilter Sitzung beitreten: Einladung einfuegen, der Tab verbindet sich selbst (Terminal guest).
  let { open = $bindable(false), onjoin }: { open: boolean; onjoin: (ticket: string) => void } = $props();

  let ticket = $state("");
  const ok = $derived(ticket.trim().startsWith("atelier1."));
  $effect(() => {
    if (open) ticket = "";
  });

  function submit() {
    if (!ok) return;
    onjoin(ticket.trim());
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Sitzung beitreten</Dialog.Title>
      <Dialog.Description>Einladung aus „Sitzung teilen“ einfügen. Claude läuft beim Gastgeber, du siehst sein Terminal.</Dialog.Description>
    </Dialog.Header>
    <Input bind:value={ticket} placeholder="atelier1.…" density="sm" class="font-mono" onkeydown={(e) => e.key === "Enter" && submit()} />
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (open = false)}>Abbrechen</Button>
      <Button size="sm" onclick={submit} disabled={!ok}>Beitreten</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
