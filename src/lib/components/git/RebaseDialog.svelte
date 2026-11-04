<script lang="ts">
  import { untrack } from "svelte";
  import { Button, Dialog, IconButton, Select, TextButton, Textarea } from "$lib/atelier-ui";
  import { git, type Commit } from "$lib/git";
  import { moveRow, rebaseProblem, rebaseSteps, type RebaseOp, type RebaseRow, type RebaseStep } from "$lib/rebase.logic";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";

  let {
    repo,
    from,
    onclose,
    onstart,
  }: {
    repo: string;
    /** Oldest commit to rewrite; null = closed. */
    from: Commit | null;
    onclose: () => void;
    onstart: (base: string | null, steps: RebaseStep[], pushed: boolean) => void;
  } = $props();

  const MAX = 300;
  const OPS = [
    ["Behalten", "pick"],
    ["Mit vorherigem zusammenfassen", "fixup"],
    ["Verwerfen", "drop"],
  ] as const;

  let rows = $state<RebaseRow[]>([]);
  let loading = $state(false);
  let loadError = $state("");
  let pushed = $state(false);

  $effect(() => {
    const c = from;
    if (c) untrack(() => load(c));
  });

  async function load(c: Commit) {
    rows = [];
    loadError = "";
    pushed = false;
    loading = true;
    const base = c.parents[0];
    try {
      const [log, p] = await Promise.all([git.log(repo, base ? `${base}..HEAD` : "HEAD", 0, MAX + 1), git.pushed(repo, c.sha)]);
      if (from !== c) return;
      if (!log.some((x) => x.sha === c.sha)) loadError = "Commit liegt nicht im aktuellen Branch.";
      else if (log.some((x) => x.parents.length > 1)) loadError = "Merge-Commits im Bereich werden nicht unterstützt.";
      else if (log.length > MAX) loadError = `Mehr als ${MAX} Commits ab hier – einen neueren Commit wählen.`;
      rows = log.reverse().map((x) => ({ sha: x.sha, subject: x.subject, op: "pick", edit: null, orig: "" }));
      pushed = p;
    } catch (e) {
      if (from === c) loadError = String(e);
    }
    loading = false;
  }

  async function editMessage(r: RebaseRow) {
    try {
      const d = await git.show(repo, r.sha);
      r.orig = d.commit.subject + (d.body ? "\n\n" + d.body : "");
      r.edit = r.orig;
    } catch (e) {
      loadError = String(e);
    }
  }

  const problem = $derived(loadError || rebaseProblem(rows));
  const drops = $derived(rows.some((r) => r.op === "drop"));
</script>

<Dialog.Root open={from !== null} onOpenChange={(o) => !o && onclose()}>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Interaktiver Rebase</Dialog.Title>
      <Dialog.Description>
        Älteste zuerst; die Commits werden von oben nach unten neu angewendet.
        {#if pushed}Schon gepusht: danach ist ein Force-Push nötig, andere mit diesem Stand bekommen Konflikte.{/if}
        {#if drops}Verworfene Commits sind danach nur über das Reflog zu retten.{/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
      {#if loading}
        <p class="text-muted-foreground py-4 text-center text-meta">Lädt …</p>
      {/if}
      {#each rows as r, i (r.sha)}
        <div class="border-border rounded border px-2 py-1">
          <div class="flex items-center gap-1.5">
            <Select value={r.op} options={OPS} onchange={(v) => (r.op = v as RebaseOp)} class="w-52 shrink-0" aria-label="Aktion" />
            <span class="min-w-0 flex-1 truncate text-ui {r.op === 'drop' ? 'text-muted-foreground line-through' : ''}" title={r.subject}>{r.subject}</span>
            <span class="text-muted-foreground shrink-0 font-mono text-meta">{r.sha.slice(0, 7)}</span>
            {#if r.op !== "drop"}
              <TextButton size="sm" class="shrink-0" onclick={() => (r.edit === null ? editMessage(r) : (r.edit = null))}
                >{r.edit === null ? "Nachricht …" : "Nachricht zurücksetzen"}</TextButton
              >
            {/if}
            <IconButton label="Nach oben" disabled={i === 0} onclick={() => (rows = moveRow(rows, i, -1))}><ArrowUpIcon class="size-3" /></IconButton>
            <IconButton label="Nach unten" disabled={i === rows.length - 1} onclick={() => (rows = moveRow(rows, i, 1))}
              ><ArrowDownIcon class="size-3" /></IconButton
            >
          </div>
          {#if r.edit !== null && r.op !== "drop"}
            <Textarea bind:value={r.edit} density="xs" class="mt-1 h-20 field-sizing-fixed font-mono" spellcheck={true} aria-label="Commit-Nachricht" />
          {/if}
        </div>
      {/each}
    </div>

    {#if problem}<p class="text-destructive text-meta">{problem}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={onclose}>Abbrechen</Button>
      <Button
        variant={pushed || drops ? "destructive" : "default"}
        size="sm"
        disabled={!!problem || loading || !rows.length}
        onclick={() => onstart(from?.parents[0] ?? null, rebaseSteps(rows), pushed)}>Rebase starten</Button
      >
    </div>
  </Dialog.Content>
</Dialog.Root>
