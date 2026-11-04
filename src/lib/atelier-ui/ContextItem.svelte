<script lang="ts">
  import { ContextMenu } from "bits-ui";
  import { cn } from "$lib/utils";
  import { menuItem } from "./menu";

  let { label, onSelect, destructive = false, disabled = false }: { label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean } = $props();
</script>

<ContextMenu.Item
  class={cn(menuItem, destructive && "text-destructive", disabled && "pointer-events-none opacity-50")}
  {disabled}
  {onSelect}>{label}</ContextMenu.Item
>
