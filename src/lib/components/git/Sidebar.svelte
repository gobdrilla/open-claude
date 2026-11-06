<script lang="ts">
  import { t } from "$lib/i18n";
  import Notice from "$lib/components/Notice.svelte";
  import { Badge, Button, ConfirmDialog, ContextItem, IconButton, PromptDialog, Row, SectionToggle, Select, TextButton, Textarea, menuContent, menuItem, menuSeparator } from "$lib/atelier-ui";
  import { untrack } from "svelte";
  import { ContextMenu, DropdownMenu } from "bits-ui";
  import SettingsIcon from "@lucide/svelte/icons/settings-2";
  import CheckIcon from "@lucide/svelte/icons/check";
  import { git, forge, type MergeMode, type Branch, type Tag, type Stash, type Submodule, type PullRequest, type Status } from "$lib/git";
  import { gitCmds, usesFile, type GitCmd } from "$lib/gitcmds.svelte";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import CloudIcon from "@lucide/svelte/icons/cloud";
  import TagIcon from "@lucide/svelte/icons/tag";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import GitMergeIcon from "@lucide/svelte/icons/git-merge";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import XIcon from "@lucide/svelte/icons/x";
  import { refRows, type RefRow } from "$lib/reftree";
  import { pruneSel, rangeSel, toggleSel } from "$lib/selection";
  import { age, cn } from "$lib/utils";
  import { ask } from "$lib/ask.svelte";

  let {
    repo,
    status,
    refreshKey,
    forgeKey,
    busy,
    track,
    onchange,
    onselectref,
    onshowdiff,
    onsubmodule,
    oncommand,
  }: {
    repo: string;
    /** Run a custom command (Settings › Git) with these vars. */
    oncommand?: (c: GitCmd, vars: Record<string, string>) => void;
    status: Status;
    refreshKey: number;
    /** Wie in GitView: Pull Requests kosten einen API-Call, nur bei HEAD-/Remote-/Kontowechsel neu laden. */
    forgeKey: number;
    /** Laeuft gerade eine Git-Aktion (auch aus Toolbar/Verlauf): solange ist die Seitenleiste gesperrt. */
    busy: boolean;
    track: <T>(label: string, action: () => Promise<T>) => Promise<T>;
    onchange: () => void;
    onselectref: (ref: string) => void;
    onshowdiff: (title: string, diff: string) => void;
    onsubmodule: (path: string) => void;
  } = $props();

  const cmds = $derived(gitCmds.filter((g) => !usesFile(g)));

  let branches = $state<Branch[]>([]);
  let tags = $state<Tag[]>([]);
  let stashes = $state<Stash[]>([]);
  let subs = $state<Submodule[]>([]);
  let originUrl = $state<string | null>(null);
  let pulls = $state<PullRequest[]>([]);
  let error = $state("");

  // Abschnitte einzeln einklappbar. Alles startet eingeklappt; was der User aufklappt, bleibt ueber Neustarts erhalten.
  let expanded = $state<Record<string, boolean>>(readExpanded());
  function readExpanded(): Record<string, boolean> {
    try {
      return JSON.parse(localStorage.getItem("git.expanded") ?? "{}") ?? {};
    } catch {
      return {};
    }
  }
  $effect(() => {
    try {
      localStorage.setItem("git.expanded", JSON.stringify(expanded));
    } catch {
      // Ohne localStorage gilt der Zustand nur fuer diese Sitzung.
    }
  });

  const locals = $derived(branches.filter((b) => !b.remote));
  const remoteGroups = $derived.by(() => {
    const by = new Map<string, Branch[]>();
    for (const b of branches.filter((b) => b.remote)) {
      const i = b.name.indexOf("/");
      const remote = i < 0 ? b.name : b.name.slice(0, i);
      (by.get(remote) ?? by.set(remote, []).get(remote)!).push(b);
    }
    return [...by];
  });

  const cur = $derived(locals.find((b) => b.current)?.name);
  // Ref folders share the expanded record via prefixed keys. Unset: closed, except folders holding the checked-out branch.
  const dirOpen = (pre: string, auto?: string) => (p: string) => expanded[pre + p] ?? !!auto?.startsWith(p + "/");
  const localRows = $derived(refRows(locals, (b) => b.name, dirOpen("b:", cur)));
  const remoteRows = $derived(
    remoteGroups.map(([r, list]) => [r, refRows(list, (b) => b.name.slice(r.length + 1), dirOpen(`r:${r}/`))] as const),
  );
  const tagRows = $derived(refRows(tags, (t) => t.name, dirOpen("t:")));

  // Multi-select in the local or the remote list: Cmd/Ctrl+click toggles, Shift+click takes the visible range.
  let pick = $state<{ remote: boolean; names: string[] }>({ remote: false, names: [] });
  let pickAnchor = "";
  const leaves = (rows: RefRow<Branch>[]) => rows.flatMap((r) => (r.dir ? [] : [r.ref.name]));
  const localOrder = $derived(leaves(localRows));
  const remoteOrder = $derived(remoteRows.flatMap(([, rows]) => leaves(rows)));
  // Hidden by a closed folder or gone after a reload: no longer selected, so nothing invisible gets deleted.
  const picked = $derived(pruneSel(pick.names, pick.remote ? remoteOrder : localOrder));
  const pickedSet = $derived(new Set(picked));
  const isPicked = (b: Branch, remote: boolean) => pick.remote === remote && pickedSet.has(b.name);

  function clickBranch(e: MouseEvent, b: Branch, remote: boolean) {
    const same = pick.remote === remote;
    let next = [b.name];
    if (e.shiftKey && same) next = rangeSel(remote ? remoteOrder : localOrder, pickAnchor, b.name);
    else if ((e.ctrlKey || e.metaKey) && same) next = toggleSel(picked, b.name);
    if (!e.shiftKey || !same) pickAnchor = b.name;
    pick = { remote, names: next };
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onselectref(b.sha);
  }

  /** Delete local (never the checked-out one) or remote branches; unmerged local ones get a second, forced round. */
  function deleteBranches(names: string[], remote: boolean) {
    const list = remote ? names : names.filter((n) => n !== cur);
    if (!list.length) return;
    const shown = (l: string[]) =>
      l.length === 1
        ? t("„{name}“", { name: l[0] })
        : t("{n} Branches ({list})", { n: l.length, list: l.slice(0, 5).join(", ") + (l.length > 5 ? ", …" : "") });
    const many = list.length > 1;
    const title = remote
      ? many ? t("Remote-Branches löschen") : t("Remote-Branch löschen")
      : many ? t("Branches löschen") : t("Branch löschen");
    const what = shown(list);
    askConfirm(title, remote ? t("{what} auf dem Server löschen?", { what }) : t("{what} lokal löschen?", { what }), async () => {
      const unmerged: string[] = [];
      try {
        // shortcut: one git call (remote: one push) per branch, batch in Rust if deleting dozens of remote branches is too slow.
        for (const n of list) {
          try {
            await git.branchDelete(repo, n, false, remote);
          } catch (e) {
            if (remote || !String(e).includes("not fully merged")) throw e;
            unmerged.push(n);
          }
        }
      } finally {
        pick = { remote, names: [] };
      }
      if (unmerged.length)
        askConfirm(
          t("Branch nicht gemergt"),
          unmerged.length === 1
            ? t("{what} enthält Commits, die in keinem anderen Branch liegen. Trotzdem löschen?", { what: shown(unmerged) })
            : t("{what} enthalten Commits, die in keinem anderen Branch liegen. Trotzdem löschen?", { what: shown(unmerged) }),
          async () => {
            for (const n of unmerged) await git.branchDelete(repo, n, true, false);
          },
        );
    });
  }

  const base = $derived(branches.find((b) => b.base)?.base ?? null);
  // Fest eingestellt (git config ocui.base) statt automatisch erkannt.
  let fixedBase = $state<string | null>(null);
  // Uebliche Namen fuer den Production-Branch als Schnellauswahl, Remote bevorzugt.
  const PROD = ["main", "master", "stable", "production", "prod", "release", "develop"];
  const candidates = $derived(
    PROD.map((n) => branches.find((b) => b.name === `origin/${n}`) ?? branches.find((b) => b.name === n))
      .filter((b) => b !== undefined)
      .map((b) => b.name),
  );
  const setBase = (b: string | null) => run(t("Production-Branch"), () => git.setBase(repo, b));
  // Die Basis selbst und ihr lokales Gegenstueck (master -> origin/master) sind nie "offen".
  const isBase = (b: Branch) => b.name === base || b.upstream === base;
  const merged = (b: Branch) => b.unmerged === 0 && !isBase(b) && !b.current;
  // Noch nicht gemergt, neueste zuerst. Remote-Branch nur, wenn ihn kein lokaler mit gleichem Stand trackt.
  const allOpen = $derived(
    branches
      .filter(
        (b) =>
          (b.unmerged ?? 0) > 0 &&
          !isBase(b) &&
          !(b.remote && locals.some((l) => l.upstream === b.name && l.sha === b.sha)),
      )
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
  );
  // Standardmaessig nur Branches mit Commits aus den letzten 6 Monaten, aeltere per Klick dazu.
  const STALE_MS = 183 * 864e5;
  const stale = (b: Branch) => Date.now() - Date.parse(b.date) > STALE_MS;
  let showStale = $state(false);
  const staleCount = $derived(allOpen.filter(stale).length);
  const open = $derived(showStale ? allOpen : allOpen.filter((b) => !stale(b)));

  // Branch -> offener Branch, der ihn schon enthaelt (kommt mit dessen Merge automatisch in die Basis).
  let within = $state<Record<string, string>>({});
  $effect(() => {
    const list = open;
    untrack(() => loadWithin(list));
  });
  async function loadWithin(list: Branch[]) {
    const nest = await git.nesting(repo, list.map((b) => b.name)).catch(() => ({}) as Record<string, string[]>);
    const res: Record<string, string> = {};
    for (const b of list) {
      const has = new Set(nest[b.name] ?? []);
      // Engster Treffer = der mit den wenigsten offenen Commits. Gleicher Stand ist ein Duplikat, kein "enthalten".
      const parent = list
        .filter((o) => o.name !== b.name && o.sha !== b.sha && has.has(o.name))
        .sort((x, y) => (x.unmerged ?? 0) - (y.unmerged ?? 0))[0];
      if (parent) res[b.name] = parent.name;
    }
    if (list === open) within = res; // inzwischen neu geladen: Ergebnis verwerfen
  }
  // Baum: enthaltene Branches eingerueckt unter dem, der sie mitbringt.
  const tree = $derived.by(() => {
    const out: { b: Branch; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const b of open.filter((o) => (within[o.name] ?? null) === parent)) {
        out.push({ b, depth });
        walk(b.name, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  const merges = $derived(tree.filter((t) => t.depth === 0).length);

  async function load() {
    error = "";
    try {
      const [b, t, s, remotes, fixed, m] = await Promise.all([
        git.branches(repo),
        git.tags(repo),
        git.stashes(repo),
        git.remotes(repo),
        git.getBase(repo),
        git.submodules(repo),
      ]);
      subs = m;
      branches = b;
      fixedBase = fixed;
      tags = t;
      stashes = s;
      originUrl = remotes.find((r) => r.name === "origin")?.url ?? null;
    } catch (e) {
      error = String(e);
    }
  }

  $effect(() => {
    repo;
    refreshKey;
    load();
  });

  $effect(() => {
    forgeKey;
    const [r, url] = [repo, originUrl];
    if (!url) return void (pulls = []);
    forge
      .pulls(r, url)
      .catch(() => [])
      .then((p) => r === repo && url === originUrl && (pulls = p));
  });

  async function run<T>(label: string, action: () => Promise<T>) {
    if (busy) return;
    error = "";
    try {
      await track(label, action);
      onchange(); // zieht ueber refreshKey auch load() nach
    } catch (e) {
      error = String(e);
    }
  }

  // Bestaetigung fuer destruktive Aktionen.
  let confirm = $state<{ title: string; message: string; run: () => Promise<void> } | null>(null);
  function askConfirm(title: string, message: string, action: () => Promise<void>) {
    confirm = { title, message, run: action };
  }
  async function doConfirm() {
    if (!confirm) return;
    const { title, run: action } = confirm;
    confirm = null;
    await run(title, action);
  }

  // Texteingabe fuer Umbenennen / Neuer Branch.
  let prompt = $state<{ title: string; action: string; run: (v: string) => Promise<void> } | null>(null);
  let promptValue = $state("");
  function askPrompt(title: string, label: string, value: string, action: (v: string) => Promise<void>) {
    prompt = { title, action: label, run: action };
    promptValue = value;
  }
  async function doPrompt() {
    if (!prompt) return;
    const { title, run: action } = prompt;
    const value = promptValue.trim();
    prompt = null;
    if (value) await run(title, () => action(value));
  }

  // Merge dialog; the chosen mode is remembered across merges.
  const MERGE_MODES = [
    [t("Standard (Fast-Forward wenn möglich)"), "default"],
    [t("Immer Merge-Commit (--no-ff)"), "no-ff"],
    [t("Nur Fast-Forward (--ff-only)"), "ff-only"],
    [t("Squash (ein Commit, ohne Merge-Verknüpfung)"), "squash"],
  ] as const;
  let mergeRev = $state<string | null>(null);
  let mergeMsg = $state("");
  let mergeError = $state("");
  let mergeMode = $state<MergeMode>(readMode());
  function readMode(): MergeMode {
    try {
      const m = localStorage.getItem("git.mergeMode");
      return MERGE_MODES.some(([, v]) => v === m) ? (m as MergeMode) : "default";
    } catch {
      return "default";
    }
  }
  function openMerge(rev: string) {
    mergeRev = rev;
    mergeMsg = "";
    mergeError = "";
  }
  async function doMerge() {
    if (!mergeRev || busy) return;
    const [rev, mode, msg] = [mergeRev, mergeMode, mergeMsg.trim() ? mergeMsg : null];
    try {
      localStorage.setItem("git.mergeMode", mode);
    } catch {
      // Ohne localStorage gilt die Wahl nur fuer diese Sitzung.
    }
    mergeError = "";
    try {
      await track("Merge", () => git.merge(repo, rev, mode, mode === "ff-only" ? null : msg));
      mergeRev = null;
      onchange();
    } catch (e) {
      // Shown in the dialog: the sidebar notice cuts it to one line, and another mode is one click away here.
      mergeError = String(e);
    }
  }

  // Lokal wie remote: das Backend wechselt auf einen vorhandenen lokalen Branch oder legt den
  // Tracking-Branch an (Name ueber die echten Remotes, auch bei "up/stream/x").
  function checkout(b: Branch) {
    if (b.current) return;
    ask("checkout", t("Branch wechseln"), t("Auf „{name}“ wechseln?", { name: b.name }), () =>
      run(t("Branch-Wechsel"), () => git.checkout(repo, b.name, false, null)),
    );
  }

  const SUB_STATE = { "-": t("nicht geladen"), "+": t("anderer Commit"), U: t("Konflikt"), " ": "" };
  // Split around the placeholder so the branch keeps its mono font in either word order.
  const notIn = t("Nicht in {base}").split("{base}");
  const updateSub = (path: string | null) => run(t("Submodule"), () => git.submoduleUpdate(repo, path));
  // Nicht geladen: leerer Ordner, erst holen
  const openSub = (m: Submodule) => (m.state === "-" ? updateSub(m.path).then(() => onsubmodule(m.path)) : onsubmodule(m.path));

  async function showStash(s: Stash) {
    try {
      const diff = await git.stashShow(repo, s.index);
      onshowdiff(s.message, diff);
    } catch (e) {
      error = String(e);
    }
  }
</script>

{#snippet folder(r: RefRow<unknown> & { dir: true }, key: string)}
  <SectionToggle
    variant="item"
    class="rounded-md py-1 text-meta"
    style="padding-left:{4 + r.depth * 12}px"
    open={r.open}
    onclick={() => (expanded[key] = !r.open)}
    title={r.path + "/"}
  >
    <FolderIcon class="text-muted-foreground size-3 shrink-0" />
    <span class="min-w-0 flex-1 truncate font-mono">{r.label}</span>
    <span class="text-muted-foreground font-mono text-meta">{r.count}</span>
  </SectionToggle>
{/snippet}

{#snippet pickBar(remote: boolean)}
  {#if pick.remote === remote && picked.length > 1}
    <div class="bg-primary/10 mx-1 mb-1 flex items-center gap-1 rounded-md px-2 py-0.5">
      <span class="text-muted-foreground flex-1 text-meta whitespace-nowrap">{t("{n} ausgewählt", { n: picked.length })}</span>
      <Button variant="ghost-danger" size="2xs" disabled={busy} onclick={() => deleteBranches(picked, remote)}>{t("Löschen …")}</Button>
      <IconButton size="xs" label={t("Auswahl aufheben")} onclick={() => (pick = { remote, names: [] })}><XIcon class="size-3" /></IconButton>
    </div>
  {/if}
{/snippet}

{#snippet pickItems(b: Branch, remote: boolean)}
  {#if isPicked(b, remote) && picked.length > 1}
    <ContextItem label={t("Ausgewählte löschen ({n}) …", { n: picked.length })} onSelect={() => deleteBranches(picked, remote)} destructive />
    <ContextMenu.Separator class={menuSeparator} />
  {/if}
{/snippet}

{#snippet choice(label: string, value: string | null)}
  <DropdownMenu.Item
    class={menuItem}
    onSelect={() => setBase(value)}
  >
    <CheckIcon class="size-3 {fixedBase === value ? '' : 'invisible'}" />
    <span class={value ? "font-mono" : ""}>{label}</span>
  </DropdownMenu.Item>
{/snippet}

<div class="flex h-full flex-col overflow-y-auto p-1.5 text-ui {busy ? 'pointer-events-none opacity-60' : ''}" aria-busy={busy}>
  <Notice bind:text={error} />

  <!-- Noch nicht in die Basis gemergt: Ueberblick ueber alle offenen Branches -->
  {#if base}
    <div class="border-border border-b py-1.5 last:border-b-0">
      <div class="hover:bg-accent/40 flex items-center rounded-lg pr-1">
        <SectionToggle
          class="flex-1 hover:bg-transparent"
          open={!!expanded.open}
          onclick={() => (expanded.open = !expanded.open)}
          title={t("Branches mit Commits, die noch nicht in {base} sind", { base }) +
            (merges < open.length ? t(" · {n} Merges reichen, eingerückte kommen mit", { n: merges }) : "")}
        >
          <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><GitMergeIcon class="size-3" /></span>
          <!-- origin/ dropped and no mono font, so "Nicht in master" fits at 900 px; the tooltip has the full ref -->
          <span class="min-w-0 flex-1 truncate">{notIn[0]}<span>{base.replace(/^origin\//, "")}</span>{notIn[1]}</span>
          <span class="font-mono text-meta {open.length ? 'text-warning' : 'text-muted-foreground'}"
            >{open.length}</span
          >
        </SectionToggle>
        <!-- Production-Branch waehlen: automatisch oder fest pro Repo -->
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <IconButton
                {...props}
                label={t("Production-Branch wählen")}
                title={fixedBase ? t("Production-Branch fest: {branch}", { branch: fixedBase }) : t("Production-Branch wählen")}
                active={!!fixedBase}><SettingsIcon class="size-3" /></IconButton
              >
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              class={cn(menuContent, "min-w-52")}
            >
              <p class="text-muted-foreground px-2 py-1 text-meta">{t("Production-Branch")}</p>
              {@render choice(t("Automatisch erkennen"), null)}
              {#each candidates as c (c)}
                {@render choice(c, c)}
              {/each}
              {#if fixedBase && !candidates.includes(fixedBase)}
                {@render choice(fixedBase, fixedBase)}
              {/if}
              <p class="text-muted-foreground px-2 pt-1.5 pb-1 text-meta">{t("Andere: Rechtsklick auf einen Branch.")}</p>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {#if expanded.open}
        <div class="px-1 pb-1">
          {#if open.length === 0}
            <p class="text-muted-foreground px-2 py-1 pl-6 text-meta">
              {allOpen.length ? t("Nichts aus den letzten 6 Monaten.") : t("Alles gemergt.")}
            </p>
          {/if}
          {#each tree as { b, depth } (b.name)}
            <Row
              dim={stale(b)}
              style="padding-left:{24 + depth * 12}px"
              onclick={() => onselectref(b.sha)}
              ondblclick={() => checkout(b)}
              title={(b.unmerged === 1
                ? t("{name}: 1 Commit noch nicht in {base}", { name: b.name, base: base ?? "" })
                : t("{name}: {n} Commits noch nicht in {base}", { name: b.name, n: b.unmerged ?? 0, base: base ?? "" })) +
                (within[b.name] ? t(" · schon in {parent}, kommt mit dessen Merge", { parent: within[b.name] }) : "") +
                t(" · letzter: {subject}", { subject: b.subject })}
            >
              {#if depth}<span class="text-muted-foreground -ml-1 shrink-0">↳</span>{/if}
              <!-- Remote-Praefix als Icon, sonst schneidet "origin/" den eigentlichen Namen ab -->
              {#if b.remote}<CloudIcon class="text-muted-foreground size-3 shrink-0" />{/if}
              <span class="min-w-0 flex-1 truncate font-mono {b.remote ? 'text-muted-foreground' : ''} {b.current
                  ? 'text-primary font-semibold'
                  : ''}">{b.remote ? b.name.slice(b.name.indexOf("/") + 1) : b.name}</span
              >
              <span class="shrink-0 font-mono text-meta text-warning">+{b.unmerged}</span>
              <span class="text-muted-foreground w-12 shrink-0 text-right font-mono text-meta whitespace-nowrap">{age(b.date)}</span>
            </Row>
          {/each}
          {#if staleCount}
            <TextButton size="sm" class="px-2 py-1 pl-6" onclick={() => (showStale = !showStale)}>
              {showStale ? t("Ältere ausblenden") : t("{n} ältere (über 6 Monate) anzeigen", { n: staleCount })}
            </TextButton>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Branches -->
  <div class="border-border border-b py-1.5 last:border-b-0">
    <SectionToggle open={!!expanded.branches} onclick={() => (expanded.branches = !expanded.branches)}>
      <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><GitBranchIcon class="size-3" /></span>
      <span class="flex-1">Branches</span>
      <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{locals.length}</span>
    </SectionToggle>
    {#if expanded.branches}
      <div class="px-1 pb-1">
        {@render pickBar(false)}
        {#if locals.length === 0}
          <p class="text-muted-foreground px-2 py-1 pl-6 text-meta">{t("Keine.")}</p>
        {/if}
        {#each localRows as r (r.dir ? r.path + "/" : r.path)}
          {#if r.dir}
            {@render folder(r, "b:" + r.path)}
          {:else}
          {@const b = r.ref}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <Row
                style="padding-left:{24 + r.depth * 12}px"
                active={b.current}
                selected={isPicked(b, false)}
                dim={merged(b)}
                ondblclick={() => checkout(b)}
                onclick={(e) => clickBranch(e, b, false)}
                title={merged(b) ? t("In {base} gemergt", { base: base ?? "" }) : undefined}
              >
                <span class="min-w-0 flex-1 truncate font-mono" title={b.name}>{r.label}</span>
                {#if b.ahead}
                  <span class="text-primary flex items-center font-mono text-meta"
                    ><ArrowUpIcon class="size-2.5" />{b.ahead}</span
                  >
                {/if}
                {#if b.behind}
                  <span class="text-muted-foreground flex items-center font-mono text-meta"
                    ><ArrowDownIcon class="size-2.5" />{b.behind}</span
                  >
                {/if}
              </Row>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content class={menuContent}>
                {@render pickItems(b, false)}
                {#if !b.current}
                  <ContextItem label={t("Auschecken")} onSelect={() => checkout(b)} />
                  <ContextItem label={t("In aktuellen mergen …")} onSelect={() => openMerge(b.name)} />
                  <ContextItem
                    label={t("Aktuellen darauf rebasen")}
                    onSelect={() =>
                      ask("rebase", t("Rebasen"), t("{branch} auf „{name}“ rebasen?", { branch: status.branch ?? "HEAD", name: b.name }), () =>
                        run("Rebase", () => git.rebase(repo, b.name)),
                      )}
                  />
                {/if}
                {#if b.name !== base}
                  <ContextItem label={t("Als Production-Branch festlegen")} onSelect={() => setBase(b.name)} />
                {/if}
                <ContextItem
                  label={t("Umbenennen")}
                  onSelect={() =>
                    askPrompt(t("Branch umbenennen"), t("Umbenennen"), b.name, (v) => git.branchRename(repo, b.name, v))}
                />
                <ContextItem
                  label={t("Neuer Branch ab hier")}
                  onSelect={() =>
                    askPrompt(t("Neuer Branch ab {sha}", { sha: b.name }), t("Anlegen"), "", async (v) => {
                      await git.checkout(repo, v, true, b.name);
                    })}
                />
                {#if !b.current}
                  <ContextItem label={t("Löschen …")} onSelect={() => deleteBranches([b.name], false)} destructive />
                {/if}
                {#if oncommand && cmds.length}
                  <ContextMenu.Separator class={menuSeparator} />
                  {#each cmds as g (g.name)}
                    <ContextItem label={g.name} onSelect={() => oncommand(g, { BRANCH: b.name, SHA: b.sha })} />
                  {/each}
                {/if}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Remotes -->
  <div class="border-border border-b py-1.5 last:border-b-0">
    <SectionToggle open={!!expanded.remotes} onclick={() => (expanded.remotes = !expanded.remotes)}>
      <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><CloudIcon class="size-3" /></span>
      <span class="flex-1">Remotes</span>
      <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{branches.length - locals.length}</span>
    </SectionToggle>
    {#if expanded.remotes}
      <div class="px-1 pb-1">
        {#if remoteGroups.length === 0}
          <p class="text-muted-foreground px-2 py-1 pl-6 text-meta">{t("Keine.")}</p>
        {/if}
        {@render pickBar(true)}
        {#each remoteRows as [remote, rows] (remote)}
          <p class="text-muted-foreground px-2 pt-1 pl-6 font-mono text-meta">{remote}</p>
          {#each rows as r (r.dir ? r.path + "/" : r.path)}
            {#if r.dir}
              {@render folder(r, `r:${remote}/${r.path}`)}
            {:else}
            {@const b = r.ref}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <Row
                  style="padding-left:{24 + r.depth * 12}px"
                  selected={isPicked(b, true)}
                  dim={merged(b)}
                  ondblclick={() => checkout(b)}
                  onclick={(e) => clickBranch(e, b, true)}
                  title={merged(b) ? t("In {base} gemergt", { base: base ?? "" }) : undefined}
                >
                  <span class="min-w-0 flex-1 truncate font-mono" title={b.name}>{r.label}</span>
                </Row>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content class={menuContent}>
                  {@render pickItems(b, true)}
                  <ContextItem label={t("Auschecken (Tracking-Branch)")} onSelect={() => checkout(b)} />
                  <ContextItem label={t("In aktuellen mergen …")} onSelect={() => openMerge(b.name)} />
                  {#if b.name !== base}
                    <ContextItem label={t("Als Production-Branch festlegen")} onSelect={() => setBase(b.name)} />
                  {/if}
                  <ContextItem label={t("Löschen (remote) …")} onSelect={() => deleteBranches([b.name], true)} destructive />
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
            {/if}
          {/each}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Tags -->
  <div class="border-border border-b py-1.5 last:border-b-0">
    <SectionToggle open={!!expanded.tags} onclick={() => (expanded.tags = !expanded.tags)}>
      <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><TagIcon class="size-3" /></span>
      <span class="flex-1">Tags</span>
      <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{tags.length}</span>
    </SectionToggle>
    {#if expanded.tags}
      <div class="px-1 pb-1">
        {#if tags.length === 0}
          <p class="text-muted-foreground px-2 py-1 pl-6 text-meta">{t("Keine.")}</p>
        {/if}
        {#each tagRows as r (r.dir ? r.path + "/" : r.path)}
          {#if r.dir}
            {@render folder(r, "t:" + r.path)}
          {:else}
          {@const tg = r.ref}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <Row style="padding-left:{24 + r.depth * 12}px" onclick={() => onselectref(tg.sha)}>
                <span class="min-w-0 flex-1 truncate font-mono" title={tg.name}>{r.label}</span>
              </Row>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content class={menuContent}>
                <ContextItem label={t("Pushen")} onSelect={() => run("Tag-Push", () => git.tagPush(repo, tg.name))} />
                <ContextItem
                  label={t("Löschen …")}
                  onSelect={() => askConfirm(t("Tag löschen"), t("Tag „{name}“ löschen?", { name: tg.name }), () => git.tagDelete(repo, tg.name))}
                  destructive
                />
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Submodule (nur wenn vorhanden) -->
  {#if subs.length}
    <div class="border-border border-b py-1.5 last:border-b-0">
      <div class="flex items-center">
        <SectionToggle class="flex-1" open={!!expanded.subs} onclick={() => (expanded.subs = !expanded.subs)}>
          <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><BoxesIcon class="size-3" /></span>
          <span class="flex-1">{t("Submodule")}</span>
          <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{subs.length}</span>
        </SectionToggle>
        <!-- Nur fuer ungeladene: "+" kann auch ein neuer, noch nicht eingetragener Commit im Submodul sein -->
        {#if subs.some((m) => m.state === "-")}
          <Button
            variant="ghost"
            size="2xs"
            class="text-primary mr-1"
            disabled={busy}
            title="git submodule update --init --recursive"
            onclick={() => updateSub(null)}>{t("Alle laden")}</Button
          >
        {/if}
      </div>
      {#if expanded.subs}
        <div class="px-1 pb-1">
          {#each subs as m (m.path)}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <Row
                  indent
                  disabled={busy}
                  title={t("{path} @ {sha} – öffnen", { path: m.path, sha: m.sha.slice(0, 7) })}
                  onclick={() => openSub(m)}
                >
                  <span class="min-w-0 flex-1 truncate font-mono">{m.path}</span>
                  {#if m.state !== " "}
                    <span class="rounded-full px-1.5 text-[10px] {m.state === 'U' ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'}"
                      >{SUB_STATE[m.state]}</span
                    >
                  {:else}
                    <span class="text-muted-foreground font-mono text-meta">{m.sha.slice(0, 7)}</span>
                  {/if}
                </Row>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content class={menuContent}>
                  <ContextItem label={t("Öffnen")} onSelect={() => openSub(m)} />
                  <ContextItem label={m.state === "-" ? t("Laden") : t("Auf eingetragenen Commit setzen")} onSelect={() => updateSub(m.path)} />
                  <ContextItem label={t("Pfad kopieren")} onSelect={() => navigator.clipboard.writeText(m.path)} />
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Stashes -->
  <div class="border-border border-b py-1.5 last:border-b-0">
    <SectionToggle open={!!expanded.stashes} onclick={() => (expanded.stashes = !expanded.stashes)}>
      <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><ArchiveIcon class="size-3" /></span>
      <span class="flex-1">Stashes</span>
      <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{stashes.length}</span>
    </SectionToggle>
    {#if expanded.stashes}
      <div class="px-1 pb-1">
        {#if stashes.length === 0}
          <p class="text-muted-foreground px-2 py-1 pl-6 text-meta">{t("Keine.")}</p>
        {/if}
        {#each stashes as s (s.index)}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <Row indent onclick={() => showStash(s)}>
                <span class="min-w-0 flex-1 truncate" title={s.message}>{s.message}</span>
                <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{s.branch}</span>
              </Row>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content class={menuContent}>
                <ContextItem
                  label={t("Anwenden")}
                  onSelect={() =>
                    ask("stash", t("Stash anwenden"), t("„{name}“ anwenden?", { name: s.message }), () =>
                      run("Stash", () => git.stashApply(repo, s.index, false)),
                    )}
                />
                <ContextItem
                  label="Pop"
                  onSelect={() =>
                    ask("stash", t("Stash anwenden"), t("„{name}“ anwenden und aus der Liste entfernen?", { name: s.message }), () =>
                      run("Stash", () => git.stashApply(repo, s.index, true)),
                    )}
                />
                <ContextItem label={t("Anzeigen")} onSelect={() => showStash(s)} />
                <ContextItem
                  label={t("Löschen …")}
                  onSelect={() => askConfirm(t("Stash löschen"), t("„{name}“ verwerfen?", { name: s.message }), () => git.stashDrop(repo, s.index))}
                  destructive
                />
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Pull Requests (nur wenn origin bekannt) -->
  {#if originUrl}
    <div class="border-border border-b py-1.5 last:border-b-0">
      <SectionToggle open={!!expanded.pulls} onclick={() => (expanded.pulls = !expanded.pulls)}>
        <span class="bg-muted-foreground/15 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-md"><GitPullRequestIcon class="size-3" /></span>
        <span class="flex-1">Pull Requests</span>
        <span class="bg-secondary text-muted-foreground rounded-full px-1.5 font-mono text-[10px]">{pulls.length}</span>
      </SectionToggle>
      {#if expanded.pulls}
        <div class="px-1 pb-1">
          {#if pulls.length === 0}
            <p class="text-muted-foreground px-2 py-1 pl-6 text-meta">{t("Keine offenen.")}</p>
          {/if}
          {#each pulls as p (p.number)}
            <Row
              indent
              onclick={() => forge.openUrl(p.web_url)}
              title={p.title}
            >
              <span class="text-muted-foreground font-mono">#{p.number}</span>
              <span class="min-w-0 flex-1 truncate">{p.title}</span>
              {#if p.draft}<Badge variant="outline" class="text-muted-foreground text-meta">{t("Entwurf")}</Badge>{/if}
            </Row>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<ConfirmDialog
  open={confirm !== null}
  title={confirm?.title ?? ""}
  message={confirm?.message}
  action={t("Löschen")}
  onconfirm={doConfirm}
  oncancel={() => (confirm = null)}
/>

<ConfirmDialog
  open={mergeRev !== null}
  title={t("„{rev}“ in {branch} mergen", { rev: mergeRev ?? "", branch: status.branch ?? "HEAD" })}
  message={mergeMode === "squash" ? t("Bei Konflikten: lösen, dann im Tab Änderungen committen.") : undefined}
  action={t("Mergen")}
  tone="default"
  wide
  disabled={busy}
  onconfirm={doMerge}
  oncancel={() => (mergeRev = null)}
>
  <div class="flex flex-col gap-2">
    <Select bind:value={mergeMode} options={MERGE_MODES} onchange={() => (mergeError = "")} class="h-7 w-full" aria-label={t("Merge-Modus")} />
    {#if mergeMode !== "ff-only"}
      <Textarea bind:value={mergeMsg} density="sm" class="h-24 field-sizing-fixed font-mono" spellcheck={true} placeholder={t("Eigene Nachricht (optional)")} aria-label={t("Merge-Nachricht")} />
    {/if}
    {#if mergeError}<p class="text-destructive text-ui max-h-40 overflow-y-auto break-words whitespace-pre-wrap">{mergeError}</p>{/if}
  </div>
</ConfirmDialog>

<PromptDialog
  open={prompt !== null}
  title={prompt?.title ?? ""}
  bind:value={promptValue}
  placeholder="feature/…"
  action={prompt?.action}
  mono
  onsubmit={doPrompt}
  oncancel={() => (prompt = null)}
/>
