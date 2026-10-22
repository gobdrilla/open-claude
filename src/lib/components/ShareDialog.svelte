<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { invoke } from "@tauri-apps/api/core";
  import { Switch } from "$lib/components/kit";
  import { shares } from "$lib/share.svelte";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import CheckIcon from "@lucide/svelte/icons/check";

  // Sitzung teilen (Host). Oeffnen startet das Teilen; die Einladung bleibt gueltig, bis man es beendet.
  let { open = $bindable(false), id, cwd }: { open: boolean; id: string; cwd: string } = $props();

  let error = $state("");
  let copied = $state(false);
  const share = $derived(shares[id]);

  $effect(() => {
    if (!open || shares[id]) return;
    error = "";
    invoke<string>("share_start", { id, cwd }).then(
      (ticket) => (shares[id] ??= { ticket, guests: 0, write: false }),
      (e) => (error = String(e)),
    );
  });

  async function copy() {
    if (!share) return;
    await navigator.clipboard.writeText(share.ticket);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function setWrite(on: boolean) {
    if (!share) return;
    await invoke("share_write", { id, on });
    share.write = on;
  }

  async function stop() {
    await invoke("share_stop", { id });
    delete shares[id];
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Sitzung teilen</Dialog.Title>
      <Dialog.Description>
        Wer die Einladung hat, sieht dieses Terminal und das Aktivitäts-Panel live. Claude läuft weiter nur bei dir.
      </Dialog.Description>
    </Dialog.Header>

    {#if error}
      <p class="text-destructive text-xs">{error}</p>
    {:else if !share}
      <p class="text-muted-foreground text-xs">Einladung wird erstellt …</p>
    {:else}
      <div class="grid min-w-0 gap-3">
        <div class="flex min-w-0 items-start gap-2">
          <code class="bg-muted max-h-20 min-w-0 flex-1 overflow-y-auto rounded px-2 py-1.5 text-[11px] leading-snug break-all select-all">{share.ticket}</code>
          <Button size="sm" variant="secondary" onclick={copy}>
            {#if copied}<CheckIcon class="size-3.5" />{:else}<CopyIcon class="size-3.5" />{/if} Kopieren
          </Button>
        </div>
        <p class="text-muted-foreground text-xs">
          {share.guests === 0 ? "Noch niemand verbunden." : share.guests === 1 ? "1 Gast verbunden." : `${share.guests} Gäste verbunden.`}
        </p>
        <div class="flex items-start gap-2 text-sm">
          <span class="mt-1"><Switch on={share.write} label="Gäste dürfen tippen" onclick={() => setWrite(!share.write)} /></span>
          <span>
            Gäste dürfen tippen
            <span class="text-muted-foreground block text-xs">
              Sie steuern dann Claude auf deinem Rechner, inklusive Befehlen, die Claude ausführt. Nur für Leute, denen du vertraust.
            </span>
          </span>
        </div>
      </div>
    {/if}

    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (open = false)}>Schließen</Button>
      {#if share}<Button variant="destructive" size="sm" onclick={stop}>Teilen beenden</Button>{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
