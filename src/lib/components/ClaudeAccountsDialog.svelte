<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { confirm } from "$lib/confirm.svelte";
  import { forge } from "$lib/git";
  import { ptyClose, ptyWrite } from "$lib/files";
  import CheckIcon from "@lucide/svelte/icons/check";
  import UserIcon from "@lucide/svelte/icons/user";

  type Account = { email: string; org: string };

  // running: offene Claude-Sitzungen; sie nutzen bis zum Neustart das bisherige Konto
  let { open = $bindable(false), running = 0 }: { open: boolean; running?: number } = $props();

  let current = $state<Account | null>(null);
  let saved = $state<Account[]>([]);
  let error = $state("");
  let busy = $state(false);
  // Ohne gemerkte Konten zeigte die Liste waehrend des Lesens sonst kurz "Nicht angemeldet."
  let loading = $state(false);
  // Laufende Anmeldung (claude auth login in einer PTY)
  let login = $state<{ id: string; out: string } | null>(null);
  let code = $state("");
  let off: Promise<UnlistenFn>[] = [];

  async function load() {
    error = "";
    loading = true;
    try {
      // Aktuelle Anmeldung gleich merken, sonst waere sie nach einem Wechsel weg
      await invoke("claude_account_save");
      ({ current, saved } = await invoke<{ current: Account | null; saved: Account[] }>("claude_accounts"));
    } catch (e) {
      error = String(e);
    }
    loading = false;
  }
  $effect(() => {
    if (open) load();
    else stopLogin();
  });

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }

  const restartHint = () => (running ? `\n\n${running} laufende Sitzung(en) nutzen bis zum Neustart weiter das bisherige Konto.` : "");

  async function switchTo(a: Account) {
    if (!(await confirm(`Zu ${a.email} wechseln? Gilt für neu gestartete Sitzungen.${restartHint()}`, "Wechseln", "Konto wechseln", { tone: "default" }))) return;
    act(() => invoke("claude_account_switch", { email: a.email }));
  }

  async function forget(a: Account) {
    if (!(await confirm(`${a.email} aus der Liste entfernen? Angemeldet bleibt, wer gerade aktiv ist.`, "Entfernen"))) return;
    act(() => invoke("claude_account_forget", { email: a.email }));
  }

  async function logout() {
    if (!current || !(await confirm(`${current.email} bei Claude abmelden?${restartHint()}`, "Abmelden"))) return;
    act(() => invoke("claude_logout"));
  }

  // Terminal-Steuerzeichen raus; die Ausgabe dient nur zum Lesen und fuer den Link
  const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g, "");
  const url = $derived(login?.out.match(/https:\/\/\S+/g)?.at(-1) ?? "");

  async function startLogin() {
    error = "";
    await invoke("claude_account_save").catch(() => {});
    const id = `login-${crypto.randomUUID()}`;
    const dec = new TextDecoder();
    login = { id, out: "" };
    code = "";
    const out = new Channel<ArrayBuffer>((buf) => {
      if (login?.id === id) login.out = (login.out + plain(dec.decode(new Uint8Array(buf), { stream: true }))).slice(-4000);
    });
    off = [
      listen<number | null>(`pty-exit:${id}`, async (e) => {
        if (login?.id !== id) return;
        const out = login.out;
        stopLogin();
        if (e.payload === 0) await act(() => invoke("claude_account_save"));
        else error = `Anmeldung nicht abgeschlossen.\n${out.trim().split("\n").slice(-4).join("\n")}`;
      }),
    ];
    try {
      await Promise.all(off);
      await invoke("claude_login", { id, out });
    } catch (e) {
      stopLogin();
      error = String(e);
    }
  }

  function stopLogin() {
    for (const p of off) p.then((f) => f(), () => {});
    off = [];
    if (login) ptyClose(login.id).catch(() => {});
    login = null;
  }

  function sendCode() {
    if (!login || !code.trim()) return;
    ptyWrite(login.id, code.trim() + "\r").catch(() => {});
    code = "";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Claude-Konten</Dialog.Title>
      <Dialog.Description>An- und abmelden, zwischen gemerkten Konten wechseln. Einstellungen und Verlauf bleiben geteilt.</Dialog.Description>
    </Dialog.Header>

    {#if login}
      <div class="flex flex-col gap-2">
        <p class="text-sm">Anmeldung läuft – bitte im Browser bestätigen.</p>
        {#if url}
          <Button variant="outline" size="sm" onclick={() => forge.openUrl(url)}>Anmeldeseite öffnen</Button>
        {/if}
        <pre class="bg-background/60 text-muted-foreground max-h-40 overflow-auto rounded-lg p-2 font-mono text-[10px] whitespace-pre-wrap">{login.out.trim().split("\n").slice(-12).join("\n") || "Starte …"}</pre>
        <div class="flex gap-2">
          <Input bind:value={code} placeholder="Code aus dem Browser (falls verlangt)" class="font-mono text-xs" onkeydown={(e) => e.key === "Enter" && sendCode()} />
          <Button size="sm" variant="outline" disabled={!code.trim()} onclick={sendCode}>Senden</Button>
        </div>
        <div class="flex justify-end"><Button variant="ghost" size="sm" onclick={stopLogin}>Abbrechen</Button></div>
      </div>
    {:else}
      <ul class="border-border/60 divide-border/60 divide-y rounded-lg border">
        {#each saved as a (a.email)}
          {@const on = a.email === current?.email}
          <li class="flex items-center gap-2.5 px-3 py-2">
            <span class="grid size-7 shrink-0 place-items-center rounded-full {on ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}">
              {#if on}<CheckIcon class="size-3.5" />{:else}<UserIcon class="size-3.5" />{/if}
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium" title={a.email}>{a.email}</div>
              <div class="text-muted-foreground truncate text-xs">{on ? "Aktiv" : a.org}</div>
            </div>
            {#if on}
              <Button variant="ghost" size="sm" class="text-destructive" disabled={busy} onclick={logout}>Abmelden</Button>
            {:else}
              <Button variant="outline" size="sm" disabled={busy} onclick={() => switchTo(a)}>Wechseln</Button>
              <Button variant="ghost" size="sm" disabled={busy} onclick={() => forget(a)}>Entfernen</Button>
            {/if}
          </li>
        {:else}
          <li class="text-muted-foreground px-3 py-3 text-sm">{loading ? "Lese Konten …" : "Nicht angemeldet."}</li>
        {/each}
      </ul>
      <div class="flex justify-end">
        <Button size="sm" disabled={busy} onclick={startLogin}>{current ? "Weiteres Konto anmelden" : "Anmelden"}</Button>
      </div>
    {/if}
    {#if error}<p class="text-destructive text-xs whitespace-pre-line">{error}</p>{/if}
  </Dialog.Content>
</Dialog.Root>
