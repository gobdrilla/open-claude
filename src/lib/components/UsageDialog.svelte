<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import type { Usage } from "$lib/chat.logic";

  let { usage = $bindable() }: { usage: Usage | null } = $props();

  // Wie das Session-Panel: <50 primary, <80 gelb, sonst rot.
  const lvl = (p: number) => (p < 50 ? "bg-primary" : p < 80 ? "bg-warning" : "bg-destructive");
  const txt = (p: number) => (p < 50 ? "text-primary" : p < 80 ? "text-warning" : "text-destructive");
</script>

<Dialog.Root open={!!usage} onOpenChange={(o) => !o && (usage = null)}>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-lg">
    {#if usage}
      <Dialog.Header>
        <Dialog.Title>Nutzung</Dialog.Title>
        {#if usage.head.length}<Dialog.Description>{usage.head.join(" ")}</Dialog.Description>{/if}
      </Dialog.Header>

      <div class="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 text-xs">
        <section class="border-border/60 divide-y divide-foreground/5 rounded-lg border">
          {#each usage.limits as l (l.label)}
            <div class="p-2.5">
              <div class="flex justify-between"><span class="font-medium">{l.label}</span><span class="tabular-nums {txt(l.percent)}">{l.percent}%</span></div>
              <div class="my-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/5">
                <div class="h-full rounded-full {lvl(l.percent)}" style:width="{Math.min(100, l.percent)}%"></div>
              </div>
              {#if l.reset}<div class="text-muted-foreground">{l.reset}</div>{/if}
            </div>
          {/each}
        </section>

        {#if usage.periods.length}
          <div>
            {#each usage.intro as t, i (i)}
              <p class={i ? "text-muted-foreground text-[11px]" : "font-medium"}>{t}</p>
            {/each}
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each usage.periods as p (p.title)}
              <section class="border-border/60 space-y-2 rounded-lg border p-2.5">
                <div>
                  <div class="font-medium">{p.title}</div>
                  <div class="text-muted-foreground tabular-nums">{p.meta}</div>
                </div>
                {#each p.facts as f, i (i)}
                  {#if Number.isNaN(f.percent)}
                    <p class="text-muted-foreground">{f.text}</p>
                  {:else}
                    <div>
                      <div class="flex gap-2"><span class="w-9 shrink-0 text-right font-medium tabular-nums">{f.percent}%</span><span class="text-muted-foreground">{f.text}</span></div>
                      <div class="mt-1 ml-11 h-1 overflow-hidden rounded-full bg-foreground/5">
                        <div class="bg-primary/60 h-full rounded-full" style:width="{Math.min(100, f.percent)}%"></div>
                      </div>
                    </div>
                  {/if}
                {/each}
                {#each p.top as t (t.kind)}
                  <div>
                    <div class="text-muted-foreground mb-1">Top {t.kind}</div>
                    <div class="flex flex-wrap gap-1">
                      {#each t.items as x (x.name)}
                        <span class="bg-secondary rounded-full px-2 py-px">{x.name} <span class="text-muted-foreground tabular-nums">{x.percent}%</span></span>
                      {/each}
                    </div>
                  </div>
                {/each}
              </section>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
