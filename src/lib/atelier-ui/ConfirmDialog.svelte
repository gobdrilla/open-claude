<script lang="ts">
  import { t } from "$lib/i18n";
  import type { Snippet } from "svelte";
  import * as Dialog from "./primitives/dialog/index.js";
  import { Button } from "./primitives/button/index.js";

  let {
    open,
    title,
    message,
    action,
    onconfirm,
    oncancel,
    tone = "destructive",
    wide = false,
    disabled = false,
    children,
  }: {
    open: boolean;
    title: string;
    message?: string;
    action: string;
    onconfirm: () => void;
    oncancel: () => void;
    // destructive fuer Loeschen/Verwerfen, default (Akzentfarbe) fuer harmlose Aktionen wie Installieren
    tone?: "destructive" | "default";
    wide?: boolean;
    /** Action button disabled, e.g. while a field in children is empty. */
    disabled?: boolean;
    children?: Snippet;
  } = $props();
</script>

<Dialog.Root {open} onOpenChange={(o) => !o && oncancel()}>
  <Dialog.Content class={wide ? "sm:max-w-md" : "sm:max-w-sm"}>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{message}</Dialog.Description>
    </Dialog.Header>
    {@render children?.()}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={oncancel}>{t("Abbrechen")}</Button>
      <Button variant={tone} size="sm" onclick={onconfirm} {disabled}>{action}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
