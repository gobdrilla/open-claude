<script lang="ts">
  import { t } from "$lib/i18n";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import { Button } from "./primitives/button/index.js";
  import { Input } from "./primitives/input/index.js";

  let { value = $bindable(), oninput, onbrowse }: { value: string; oninput: () => void; onbrowse: () => void } = $props();
</script>

<div class="flex items-center gap-1.5">
  <Input bind:value {oninput} placeholder={t("Zielordner")} density="sm" class="font-mono" />
  <Button variant="outline" size="icon-sm" class="shrink-0" onclick={onbrowse} aria-label={t("Ordner wählen")}>
    <FolderIcon class="size-3.5" />
  </Button>
</div>
