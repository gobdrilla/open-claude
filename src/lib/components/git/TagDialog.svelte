<script lang="ts">
  import { t } from "$lib/i18n";
  import { Checkbox, PromptDialog, Textarea } from "$lib/atelier-ui";
  import { untrack } from "svelte";

  // target: what the tag points at, shown in the title (null = closed). A message makes the tag annotated.
  let {
    target,
    onsubmit,
    oncancel,
  }: {
    target: string | null;
    onsubmit: (name: string, message: string | null, push: boolean) => void;
    oncancel: () => void;
  } = $props();

  let name = $state("");
  let message = $state("");
  let push = $state(false);
  $effect(() => {
    if (target !== null) untrack(() => ((name = ""), (message = "")));
  });

  function submit() {
    if (target === null || !name.trim()) return; // doppeltes Enter
    onsubmit(name.trim(), message.trim() ? message : null, push);
  }
</script>

<PromptDialog
  open={target !== null}
  title={t("Tag auf {target} erstellen", { target: target ?? "" })}
  bind:value={name}
  placeholder="v1.0.0"
  action={t("Erstellen")}
  mono
  onsubmit={submit}
  {oncancel}
>
  <Textarea bind:value={message} density="sm" class="h-20 field-sizing-fixed" placeholder={t("Nachricht (optional – macht den Tag annotiert)")} aria-label={t("Tag-Nachricht")} />
  <Checkbox size="md" bind:checked={push}>{t("Danach pushen")}</Checkbox>
</PromptDialog>
