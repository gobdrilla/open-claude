<script lang="ts">
  let { on, label, onclick, disabled = false }: { on: boolean; label: string; onclick: () => void; disabled?: boolean } =
    $props();
</script>

<button
  class="relative h-3.5 w-6 shrink-0 rounded-full transition-colors disabled:opacity-50 dark:disabled:ring-muted-foreground {on
    ? 'bg-primary'
    : 'bg-secondary ring-border ring-1'}"
  role="switch"
  aria-checked={on}
  aria-label={label}
  {disabled}
  {onclick}
  ><span class="absolute top-0.5 size-2.5 rounded-full bg-white shadow-sm ring-1 ring-black/15 transition-all dark:ring-0 {on ? 'left-3' : 'left-0.5'}"></span></button
>
