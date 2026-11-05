<script lang="ts">
  // Local history of one file: a saved or outside version against the current text, ←/→ through the versions,
  // "Wiederherstellen" puts the version into the editor (unsaved, undoable).
  import { Button, DiffDialog } from "$lib/atelier-ui";
  import { fs } from "$lib/files";
  import { history, type Snap } from "$lib/history";
  import { localHistory } from "$lib/history.svelte";
  import { editor, open, setText } from "$lib/editor.svelte";
  import { LOCALE, t } from "$lib/i18n";

  let { repo }: { repo: string } = $props();

  const path = $derived(localHistory.open?.repo === repo ? localHistory.open.path : null);
  let snaps = $state.raw<Snap[]>([]);
  let at = $state(0);
  let diff = $state<string | null>(null);
  let seq = 0;

  $effect(() => {
    const p = path;
    if (!p) return void (diff = null);
    history(repo, p).then(
      (list) => {
        if (path !== p) return;
        snaps = list;
        at = 0;
        void show();
      },
      (e) => ((editor(repo).error = String(e)), close()),
    );
  });

  async function show() {
    const p = path;
    const snap = snaps[at];
    const n = ++seq;
    if (!p) return;
    if (!snap) return void (diff = "");
    const now = editor(repo).files[p]?.text ?? (await fs.read(repo, p).then((t) => t.content, () => ""));
    const d = await fs.diffTexts(repo, p, snap.text, now).catch((e) => ((editor(repo).error = String(e)), ""));
    if (n === seq && path === p) diff = d;
  }

  function step(d: 1 | -1) {
    const next = Math.min(Math.max(at + d, 0), snaps.length - 1);
    if (next === at) return;
    at = next;
    void show();
  }

  async function restore() {
    const p = path;
    const snap = snaps[at];
    if (!p || !snap) return;
    await open(repo, p);
    const f = editor(repo).files[p];
    if (!f) return;
    setText(repo, p, snap.text);
    // Replaced from outside: an open editor takes it over as one undoable change.
    f.rev++;
    close();
  }

  const close = () => (localHistory.open = null);
  const when = (ms: number) => new Date(ms).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
  const name = $derived(path?.split("/").pop() ?? "");
  const snap = $derived(snaps[at]);
</script>

<DiffDialog
  {diff}
  title={t("Lokale Historie: {name}", { name })}
  description={snap ? t("Version {n}/{total} · {when} · {why} → aktueller Stand", { n: at + 1, total: snaps.length, when: when(snap.time), why: t(snap.why) }) : (path ?? "")}
  empty={snap ? t("Gleich wie der aktuelle Stand.") : t("Noch keine Versionen: sie entstehen beim Speichern und bei Änderungen von außen.")}
  step={snaps.length > 1 ? step : undefined}
  onclose={close}
>
  {#if snap && diff}
    <Button size="xs" variant="outline" class="ml-auto shrink-0" onclick={restore}>{t("Wiederherstellen")}</Button>
  {/if}
</DiffDialog>
