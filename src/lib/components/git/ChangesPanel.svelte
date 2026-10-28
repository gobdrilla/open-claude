<script lang="ts">
  import Notice from "$lib/components/Notice.svelte";
  import { ContextItem, ConfirmDialog, fileIcon, menuContent } from "$lib/components/kit";
  import { dirname } from "$lib/tree";
  import { FILES_APP, atRef } from "$lib/editor.logic";
  import { sendToClaude } from "$lib/ide.svelte";
  import { reviewCount, sendReview } from "$lib/review.svelte";
  import { ContextMenu } from "bits-ui";
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button/index.js";
  import { git, type FileChange, type Status } from "$lib/git";
  import { hunkPatch, linesPatch, type DiffFile, type Hunk } from "$lib/diff";
  import { pruneSel, rangeSel, toggleSel } from "$lib/selection";
  import DiffView, { type HunkAction } from "./DiffView.svelte";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

  let {
    repo,
    status,
    onchange,
    onconflict,
    onedit,
    onsubmodule,
  }: {
    repo: string;
    status: Status;
    /** remote: Remote-Stand hat sich geaendert (Push), Seitenleiste und Verlauf neu laden. */
    onchange: (remote?: boolean) => void;
    onconflict: (path: string) => void;
    onedit?: (path: string) => void;
    onsubmodule: (path: string) => void;
  } = $props();

  const conflicts = $derived(status.files.filter((f) => f.conflict));
  const staged = $derived(status.files.filter((f) => !f.conflict && f.index !== "." && f.index !== "?"));
  const unstaged = $derived(status.files.filter((f) => !f.conflict && f.worktree !== "."));

  let sel = $state<{ path: string; staged: boolean } | null>(null);
  // null = Diff der gewaehlten Datei laedt noch
  let diff = $state<string | null>("");
  let error = $state("");

  // Nach Statuswechsel: Datei auf der anderen Seite weiter zeigen, falls sie nur dort noch liegt.
  $effect(() => {
    if (!sel) return;
    const { path, staged: s } = sel;
    const here = (s ? staged : unstaged).some((f) => f.path === path);
    const there = (s ? unstaged : staged).some((f) => f.path === path);
    if (!here) sel = there ? { path, staged: !s } : null;
  });

  // Mehrfachauswahl: immer nur in einer der beiden Listen. Konflikte stehen in keiner davon.
  let pick = $state<{ staged: boolean; paths: string[] }>({ staged: false, paths: [] });
  let anchor = ""; // Startpunkt fuer Umschalt+Klick
  const paths = (fs: FileChange[]) => fs.map((f) => f.path);

  // Was aus dem Status verschwindet, faellt aus der Auswahl (sonst waere es beim Wiederauftauchen wieder gewaehlt).
  $effect(() => {
    const kept = pruneSel(pick.paths, paths(pick.staged ? staged : unstaged));
    if (kept.length !== pick.paths.length) pick.paths = kept;
  });

  // Wirksame Auswahl; ohne eigene Auswahl zaehlt die Datei, deren Diff gerade gezeigt wird.
  const chosen = $derived.by(() => {
    const kept = pruneSel(pick.paths, paths(pick.staged ? staged : unstaged));
    if (kept.length || !sel) return { staged: pick.staged, paths: kept };
    return { staged: sel.staged, paths: [sel.path] };
  });
  const chosenSet = $derived(new Set(chosen.paths));
  const isChosen = (f: FileChange, isStaged: boolean) => chosen.staged === isStaged && chosenSet.has(f.path);
  const chosenIn = (files: FileChange[], isStaged: boolean) =>
    chosen.staged === isStaged ? files.filter((f) => chosenSet.has(f.path)) : [];

  function pickRow(e: MouseEvent, f: FileChange, files: FileChange[], isStaged: boolean) {
    // WebKit fokussiert Buttons beim Klick nicht; ohne Fokus kaemen Leertaste/Strg+A/Esc nicht an.
    (e.currentTarget as HTMLElement).focus();
    const same = chosen.staged === isStaged;
    let next = [f.path];
    if (e.shiftKey && same) next = rangeSel(paths(files), anchor, f.path);
    else if ((e.ctrlKey || e.metaKey) && same) next = toggleSel(chosen.paths, f.path);
    if (!e.shiftKey || !same) anchor = f.path;
    pick = { staged: isStaged, paths: next };
    if (next.includes(f.path)) sel = { path: f.path, staged: isStaged };
    else if (sel?.path === f.path && sel.staged === isStaged)
      sel = next.length ? { path: next[next.length - 1], staged: isStaged } : null;
  }

  // Alter Diff darf nicht mit den Aktionen der neuen Seite (staged/unstaged) angewendet werden.
  let shownKey = "";
  $effect(() => {
    status; // bei jedem neuen Status neu laden
    const cur = sel;
    const key = cur ? `${cur.staged}:${cur.path}` : "";
    if (key !== shownKey) diff = null;
    shownKey = key;
    if (!cur) return;
    git
      .diff(repo, cur.path, cur.staged)
      .then((d) => sel === cur && (diff = d))
      .catch((e) => {
        error = String(e);
        if (sel === cur) diff = "";
      });
  });

  // busy sperrt den Commit, solange eine Aktion laeuft (sonst zwei Commits per doppeltem Strg+Enter).
  let busy = $state(false);
  async function run(action: () => Promise<unknown>) {
    error = "";
    busy = true;
    try {
      await action();
      onchange();
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  const move = (fs: FileChange[], isStaged: boolean) =>
    run(() => (isStaged ? git.unstage(repo, paths(fs)) : git.stage(repo, paths(fs))));

  // Nach Stagen per Leertaste: Fokus auf die Datei, die jetzt an derselben Stelle der Liste steht.
  let refocus: { staged: boolean; index: number } | null = null;
  $effect(() => {
    status;
    if (!refocus) return;
    const { staged: s, index } = refocus;
    refocus = null;
    const here = document.querySelectorAll<HTMLElement>(`[data-file-list="${s}"]`);
    (here[Math.min(index, here.length - 1)] ?? document.querySelector<HTMLElement>("[data-file-list]"))?.focus();
  });

  // Bestaetigung fuer Verwerfen.
  let confirm = $state<{
    title: string;
    message: string;
    files?: FileChange[];
    run: () => Promise<unknown>;
  } | null>(null);
  function doConfirm() {
    const action = confirm!.run;
    confirm = null;
    run(action);
  }

  const patch = (file: DiffFile, hunk: Hunk, lines: Set<number>, reverse: boolean) =>
    lines.size ? linesPatch(file, hunk, lines, reverse) : hunkPatch(file, hunk);

  function apply(p: string, cached: boolean, reverse: boolean) {
    if (!p) error = "Keine geänderte Zeile gewählt.";
    else run(() => git.apply(repo, p, cached, reverse));
  }

  const actions = $derived<HunkAction[]>(
    sel?.staged
      ? [
          {
            label: "Hunk unstagen",
            lineLabel: "Zeilen unstagen",
            run: (f, h, l) => apply(patch(f, h, l, true), true, true),
          },
        ]
      : [
          {
            label: "Hunk stagen",
            lineLabel: "Zeilen stagen",
            run: (f, h, l) => apply(patch(f, h, l, false), true, false),
          },
          {
            label: "Hunk verwerfen",
            lineLabel: "Zeilen verwerfen",
            destructive: true,
            run: (f, h, l) => {
              const p = patch(f, h, l, true);
              confirm = {
                title: l.size ? "Zeilen verwerfen?" : "Hunk verwerfen?",
                message: `Die Änderungen in ${f.newPath} gehen verloren.`,
                run: () => git.apply(repo, p, false, true),
              };
            },
          },
        ],
  );

  function discard(fs: FileChange[]) {
    if (fs.length === 0) return;
    const [f] = fs;
    const loose = fs.filter((x) => x.worktree === "?").length;
    const go = () => git.discard(repo, paths(fs));
    confirm =
      fs.length === 1
        ? {
            title: "Änderungen verwerfen?",
            message:
              f.worktree === "?"
                ? `${f.path} ist nicht versioniert und wird gelöscht.`
                : `Alle nicht gestageten Änderungen in ${f.path} gehen verloren.`,
            run: go,
          }
        : {
            title: `Änderungen in ${fs.length} Dateien verwerfen?`,
            message:
              `Alle nicht gestageten Änderungen in diesen ${fs.length} Dateien gehen verloren.` +
              (loose
                ? ` ${loose === fs.length ? "Alle" : loose} davon ${loose === 1 ? "ist" : "sind"} nicht versioniert (?) und ${loose === 1 ? "wird" : "werden"} gelöscht.`
                : "") +
              " Das lässt sich nicht rückgängig machen.",
            files: fs,
            run: go,
          };
  }

  function reveal(f: FileChange) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    const p = dir ? `${repo}/${dir}` : repo;
    // Nur Windows-Pfade umschreiben, sonst waere der Pfad auf macOS/Linux kaputt.
    run(() => invoke("reveal", { path: repo.includes("\\") ? p.replaceAll("/", "\\") : p }));
  }

  // ---------- Commit ----------
  let message = $state("");
  let amend = $state(false);
  const subjectLen = $derived(message.split("\n")[0].length);
  const canCommit = $derived(!busy && message.trim() !== "" && (amend || staged.length > 0));
  // Fuer Amend geladene Nachricht; beim Abwaehlen wieder weg, sofern unveraendert.
  let amendMsg = "";

  async function toggleAmend() {
    if (!amend) {
      if (message === amendMsg) message = "";
      amendMsg = "";
      return;
    }
    if (message.trim()) return;
    try {
      const d = await git.show(repo, "HEAD");
      if (!amend || message.trim()) return;
      message = amendMsg = d.body.trim() ? `${d.commit.subject}\n\n${d.body.trim()}` : d.commit.subject;
    } catch (e) {
      error = String(e);
    }
  }

  function commit(push = false) {
    if (!canCommit) return;
    run(async () => {
      await git.commit(repo, message, amend);
      message = amendMsg = "";
      amend = false;
      if (!push) return;
      // Der Commit steht schon: Liste sofort aktualisieren, ein Push-Fehler darf ihn nicht verstecken.
      onchange();
      await git.push(repo, false).catch((e) => {
        throw `Commit erstellt, Push fehlgeschlagen: ${e}`;
      });
      onchange(true);
    });
  }

  const color: Record<string, string> = {
    M: "text-warning",
    A: "text-success",
    D: "text-destructive",
    R: "text-info",
    C: "text-info",
    "?": "text-muted-foreground",
  };
  const bg: Record<string, string> = {
    M: "bg-warning/15",
    A: "bg-success/15",
    D: "bg-destructive/15",
    R: "bg-info/15",
    C: "bg-info/15",
  };
</script>

{#snippet list(title: string, files: FileChange[], isStaged: boolean)}
  {@const picked = chosenIn(files, isStaged)}
  <div class="bg-background/50 ring-foreground/5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl ring-1">
    <div class="flex items-center gap-2 px-2 py-1.5 {isStaged ? 'bg-success/8' : 'bg-warning/8'}">
      <span class="size-2 shrink-0 rounded-full {isStaged ? 'bg-success shadow-success/50' : 'bg-warning shadow-warning/50'} shadow-[0_0_6px]"></span>
      <span class="flex-1 text-[11px] font-semibold">{title}</span>
      <span
        class="rounded-full px-1.5 font-mono text-[10px] {isStaged ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}"
        >{files.length}</span
      >
      <Button
        variant="ghost"
        size="xs"
        class="h-5 text-[11px]"
        disabled={files.length === 0}
        onclick={() => move(files, isStaged)}
      >
        {isStaged ? "Alles unstagen" : "Alles stagen"}
      </Button>
    </div>
    {#if picked.length > 1}
      <div class="bg-primary/10 mx-1 mt-1 flex flex-wrap items-center gap-1 rounded-md px-2 py-0.5">
        <span class="text-muted-foreground flex-1 text-[11px] whitespace-nowrap">{picked.length} ausgewählt</span>
        <Button
          variant="ghost"
          size="xs"
          class="h-5 text-[11px]"
          disabled={busy}
          title={isStaged ? "Ausgewählte unstagen" : "Ausgewählte stagen"}
          onclick={() => move(picked, isStaged)}
        >
          {isStaged ? "Unstagen" : "Stagen"}
        </Button>
        {#if !isStaged}
          <Button
            variant="ghost"
            size="xs"
            class="text-destructive h-5 text-[11px]"
            disabled={busy}
            title="Ausgewählte verwerfen …"
            onclick={() => discard(picked)}
          >
            Verwerfen …
          </Button>
        {/if}
      </div>
    {/if}
    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      {#each files as f (f.path)}
        {@const code = isStaged ? f.index : f.worktree}
        {@const fi = fileIcon(f.path)}
        {@const dir = dirname(f.path)}
        <!-- Wie im Dateimanager: Menue wirkt auf die ganze Auswahl, wenn die Zeile dazugehoert, sonst nur auf sie. -->
        {@const multi = isChosen(f, isStaged) && picked.length > 1}
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <button
              class="hover:bg-accent/60 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] select-none {isChosen(
                f,
                isStaged,
              ) ||
              (sel?.path === f.path && sel.staged === isStaged)
                ? 'bg-primary/15'
                : ''}"
              title={f.orig ? `${f.orig} → ${f.path}` : f.path}
              data-file-list={isStaged}
              onclick={(e) => pickRow(e, f, files, isStaged)}
              ondblclick={() => move([f], isStaged)}
              onkeydown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  refocus = { staged: isStaged, index: files.indexOf(f) };
                  move([f], isStaged);
                } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
                  e.preventDefault();
                  pick = { staged: isStaged, paths: paths(files) };
                  if (sel?.staged !== isStaged) sel = { path: f.path, staged: isStaged };
                } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.ctrlKey && !e.metaKey) {
                  // Ueber beide Listen hinweg wie ein Klick; Umschalt erweitert die Auswahl (nur innerhalb einer Liste).
                  e.preventDefault();
                  const all = [...document.querySelectorAll<HTMLElement>("[data-file-list]")];
                  const next = all[all.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
                  next?.dispatchEvent(new MouseEvent("click", { shiftKey: e.shiftKey }));
                  next?.scrollIntoView({ block: "nearest" });
                } else if (e.key === "Escape" && picked.length > 1) {
                  // Nur die Mehrfachauswahl aufheben (Diff bleibt stehen) und die Ansicht nicht verlassen;
                  // ohne Mehrfachauswahl geht Esc wie bisher ans Fenster (+page.svelte: zurueck).
                  e.stopPropagation();
                  pick = { staged: isStaged, paths: [] };
                }
              }}
            >
              <fi.icon class="size-3.5 shrink-0 {fi.tint}" />
              <span class="min-w-0 flex-1 truncate"
                ><span class="font-medium">{f.path.slice(dir ? dir.length + 1 : 0)}</span
                >{#if dir}<span class="text-muted-foreground ml-1.5 text-[10px]">{dir}</span>{/if}</span
              >
              <span
                class="grid size-4 shrink-0 place-items-center rounded font-mono text-[9px] font-bold {color[code] ?? ''} {bg[code] ?? 'bg-secondary'}"
                >{code}</span
              >
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class={menuContent}>
              {#if multi}
                <ContextItem
                  label={`Ausgewählte ${isStaged ? "unstagen" : "stagen"} (${picked.length})`}
                  onSelect={() => move(picked, isStaged)}
                />
                {#if !isStaged}
                  <ContextItem
                    label={`Ausgewählte verwerfen (${picked.length}) …`}
                    onSelect={() => discard(picked)}
                    destructive
                  />
                {/if}
              {:else}
                <ContextItem label={isStaged ? "Unstagen" : "Stagen"} onSelect={() => move([f], isStaged)} />
                {#if !isStaged}
                  <ContextItem label="Änderungen verwerfen …" onSelect={() => discard([f])} destructive />
                {/if}
              {/if}
              {#if onedit && code !== "D"}
                <ContextItem label="Im Editor öffnen" onSelect={() => onedit(f.path)} />
              {/if}
              <ContextItem
                label={multi ? `Ausgewählte an Claude (${picked.length})` : "An Claude"}
                onSelect={() => sendToClaude(repo, (multi ? picked : [f]).map((x) => atRef(x.path)).join(""))}
              />
              <ContextItem label="Im {FILES_APP} zeigen" onSelect={() => reveal(f)} />
              <ContextItem label="Pfad kopieren" onSelect={() => navigator.clipboard.writeText(f.path)} />
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      {:else}
        <p class="text-muted-foreground px-2 py-1 text-[11px]">Keine.</p>
      {/each}
    </div>
  </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col text-xs">
  <Notice bind:text={error} />
  <div class="flex min-h-0 flex-1">
    <!-- Schrumpft mit, damit auch im kleinen Fenster Platz fuer den Diff bleibt -->
    <div class="border-border/60 flex w-2/5 max-w-80 min-w-48 shrink-0 flex-col gap-2 border-r p-2">
      {#if conflicts.length}
        <div class="ring-destructive/30 max-h-40 shrink-0 overflow-y-auto rounded-xl p-1 ring-1">
          <div class="bg-destructive/15 text-destructive flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold">
            <TriangleAlertIcon class="size-3.5" />
            <span class="flex-1">Konflikte</span>
            <span class="font-mono text-[10px]">{conflicts.length}</span>
          </div>
          {#each conflicts as f (f.path)}
            <button
              class="text-destructive hover:bg-accent/60 flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-[11px]"
              title="Im Merge-Editor öffnen"
              onclick={() => onconflict(f.path)}
            >
              <span class="w-3 shrink-0 text-center font-mono font-bold">U</span>
              <span class="min-w-0 flex-1 truncate font-mono" title={f.path}>{f.path}</span>
            </button>
          {/each}
        </div>
      {/if}
      {@render list("Gestaged", staged, true)}
      {@render list("Nicht gestaged", unstaged, false)}

      <!-- Commit -->
      <div class="bg-background/60 ring-foreground/5 flex flex-col gap-1.5 rounded-xl p-2 ring-1">
        <textarea
          class="border-input bg-background focus-visible:ring-ring/50 h-24 resize-none rounded-lg border px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-2"
          placeholder="Commit-Nachricht (Strg+Enter, mit Umschalt: + Push)"
          bind:value={message}
          onkeydown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              // Amend braeuchte nach einem Push Force: das bleibt dem Force-Push in der Toolbar.
              commit(e.shiftKey && !amend);
            }
          }}
        ></textarea>
        <div class="flex items-center gap-2">
          <label class="flex cursor-pointer items-center gap-1 text-[11px]">
            <input type="checkbox" bind:checked={amend} onchange={toggleAmend} />
            Amend
          </label>
          <span
            class="flex-1 font-mono text-[10px] {subjectLen > 72 ? 'text-warning' : 'text-muted-foreground'}"
            title={subjectLen > 72 ? "Betreffzeile länger als 72 Zeichen" : "Länge der Betreffzeile"}
          >
            {subjectLen}/72
          </span>
          <Button
            size="xs"
            class="from-primary to-primary/70 shadow-primary/30 bg-linear-to-br shadow-md"
            disabled={!canCommit}
            onclick={() => commit()}
          >
            {amend ? "Amend" : "Commit"}{staged.length ? ` (${staged.length})` : ""}
          </Button>
          {#if !amend}
            <Button size="xs" variant="outline" disabled={!canCommit} onclick={() => commit(true)} title="Strg+Umschalt+Enter">
              Commit + Push
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <div class="relative min-w-0 flex-1">
      {#if reviewCount(repo)}
        <Button size="xs" class="absolute right-4 bottom-3 z-20 shadow-md" onclick={() => sendReview(repo)}>
          Review an Claude ({reviewCount(repo)})
        </Button>
      {/if}
      {#if sel && diff === null}
        <p class="text-muted-foreground p-3">Lädt …</p>
      {:else if sel && diff?.startsWith("Submodule ")}
        <!-- git diff --submodule=log: Commits seit dem eingetragenen Stand, "<" fallen weg, ">" kommen dazu -->
        <div class="flex flex-col gap-2 p-3">
          <pre class="font-mono text-[11px] whitespace-pre-wrap">{diff}</pre>
          <Button size="xs" variant="outline" class="self-start" onclick={() => onsubmodule(sel!.path)}>Submodul öffnen</Button>
        </div>
      {:else if sel}
        <DiffView diff={diff ?? ""} {actions} {busy} {repo} />
      {:else}
        <p class="text-muted-foreground p-3">Datei links auswählen.</p>
      {/if}
    </div>
  </div>
</div>

<ConfirmDialog
  open={confirm !== null}
  title={confirm?.title ?? ""}
  message={confirm?.message}
  action="Verwerfen"
  onconfirm={doConfirm}
  oncancel={() => (confirm = null)}
>
  {#if confirm?.files}
    <ul class="border-border max-h-40 overflow-y-auto rounded-md border py-1 font-mono text-[11px]">
      {#each confirm.files as f (f.path)}
        <li class="flex gap-1.5 px-2" title={f.path}>
          <span class="w-3 shrink-0 text-center font-bold {color[f.worktree] ?? ''}">{f.worktree}</span>
          <span class="min-w-0 flex-1 truncate">{f.path}</span>
        </li>
      {/each}
    </ul>
  {/if}
</ConfirmDialog>
