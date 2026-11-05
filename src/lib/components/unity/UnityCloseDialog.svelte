<script lang="ts">
  import { Button, Dialog, Switch } from "$lib/atelier-ui";
  import { unity } from "$lib/unity";
  import { t } from "$lib/i18n";

  /** Projektpfad; null = Dialog zu. */
  let { path = $bindable(), onclosed }: { path: string | null; onclosed?: (path: string) => void } = $props();

  let force = $state(false);
  let closing = $state(false);
  let error = $state("");

  function dismiss() {
    path = null;
    force = false;
    error = "";
  }

  async function run() {
    const p = path;
    if (!p) return;
    closing = true;
    error = "";
    try {
      await unity.close(p, force);
      dismiss();
      onclosed?.(p);
    } catch (e) {
      // Im Dialog statt dahinter: so kann man direkt mit "Erzwingen" nochmal.
      error = String(e);
    }
    closing = false;
  }
</script>

<Dialog.Root open={path !== null} onOpenChange={(o) => !o && !closing && dismiss()}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>{t("Unity-Editor schließen")}</Dialog.Title>
      <Dialog.Description>{t("Schließt ohne zu speichern. Ungesicherte Änderungen im Editor gehen verloren.")}</Dialog.Description>
    </Dialog.Header>
    <label class="flex items-center gap-2 text-ui">
      <Switch on={force} label={t("Erzwingen")} onclick={() => (force = !force)} />
      {t("Erzwingen (Prozess hart beenden, falls nötig)")}
    </label>
    {#if error}<p class="text-destructive text-ui">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={closing} onclick={dismiss}>{t("Abbrechen")}</Button>
      <Button variant="destructive" size="sm" disabled={closing} onclick={run}>
        {closing ? t("Schließt …") : t("Schließen")}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
