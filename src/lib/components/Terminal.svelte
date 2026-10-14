<script lang="ts" module>
  // Sichtbarer Text je Terminal-id, fuer Panels, die claudes Zustand am Bildschirm erkennen muessen.
  export const screens = new Map<string, () => string>();
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import ClaudeLoader from "./ClaudeLoader.svelte";
  import { evenCell } from "$lib/termcell";
  import { theme } from "$lib/theme.svelte";
  import { DARK, LIGHT, LINKS } from "$lib/termtheme";
  import { modeOf } from "$lib/claudemode";
  import { pasted } from "$lib/pasteimg.svelte";

  let {
    id,
    cwd,
    visible,
    onexit,
    onmode,
  }: { id: string; cwd: string; visible: boolean; onexit: () => void; onmode?: (mode: string) => void } = $props();

  let el: HTMLDivElement;
  let term: Terminal | undefined;
  const fit = new FitAddon();
  // Zuletzt an die PTY gemeldete Groesse; leer bis pty_open durch ist.
  let sent = "";
  let unlisten: Promise<UnlistenFn>[] = [];
  // Unmount vor pty_open-Antwort: sonst bliebe eine PTY ohne UI zurueck.
  let dead = false;
  // claude braucht ~2 s bis zur ersten Ausgabe; solange laufen die Clawds.
  let booting = $state(true);
  // claude mit theme "auto" meldet sich per DECSET 2031 fuer Farbschema-Meldungen an (xterm.js kennt den Modus nicht).
  let notify = false;

  // Zeilenhoehe und Zeichenabstand fuer den DOM-Renderer; WebGL rundet den Abstand auf ganze Geraetepixel.
  const base = { lineHeight: 1.2, letterSpacing: 0.3 };
  let webgl = false;

  // WebGL zeichnet Block- und Quadrantenzeichen in Achteln der Zelle. Bei ungerader Zellgroesse in
  // Geraetepixeln (haengt an Zoom mal Bildschirmskalierung) liegen die Kanten auf halben Pixeln:
  // Haarlinien im Logo, etwa ueber den Augen. Darum die Zelle je DPR auf gerade Pixel bringen.
  function snap() {
    if (!term || !webgl) return;
    // Private API wie im FitAddon; die Zeichengroesse gibt xterm nicht oeffentlich heraus.
    const cs = (term as any)._core?._charSizeService;
    if (cs?.width) Object.assign(term.options, evenCell(cs.width, cs.height, devicePixelRatio, base.lineHeight));
  }

  function refit() {
    // Versteckt liefert der Container 0x0 und wuerde die PTY auf 0 Spalten setzen.
    if (!term || !visible || !el.clientWidth || !el.clientHeight) return;
    snap();
    fit.fit();
    const size = `${term.cols}x${term.rows}`;
    if (!sent || size === sent) return;
    sent = size;
    invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
  }

  // Tauri faengt Datei-Drops ab (kein HTML-drop), darum der Webview-Event. Pfade fuer die Shell quoten.
  const win = navigator.userAgent.includes("Windows");
  const quote = (p: string) => (win ? `"${p}"` : `'${p.replaceAll("'", "'\\''")}'`);

  // Eingefuegtes Bild selbst merken: claude legt es erst beim Absenden ins Transkript.
  // Das hoechste "[Image #n]" im Output kurz danach ist das neue (claude zaehlt nur hoch).
  let pend: { url: string; at: number } | null = null;
  const dec = new TextDecoder();
  function grab(img: Blob | null | undefined) {
    if (img?.type.startsWith("image/")) pend = { url: URL.createObjectURL(img), at: Date.now() };
  }
  function claim(bytes: Uint8Array) {
    if (!pend) return;
    if (Date.now() - pend.at > 5000) return void (URL.revokeObjectURL(pend.url), (pend = null));
    const ns = [...dec.decode(bytes, { stream: true }).matchAll(/\[Image #(\d+)\]/g)].map((m) => Number(m[1]));
    if (!ns.length) return;
    (pasted.local[id] ??= {})[Math.max(...ns)] = pend;
    pend = null;
  }
  async function grabClipboard() {
    try {
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) return grab(await it.getType(type));
      }
    } catch {}
  }

  function onKeyEvent(e: KeyboardEvent) {
    if (e.type !== "keydown") return true;
    // Alt+E (Explorer) und Alt+G (Git-Ansicht) macht der App-Handler.
    if (e.altKey && !e.ctrlKey && ["e", "g"].includes(e.key.toLowerCase())) return false;
    // Umschalt+Esc fuehrt zur Liste zurueck; einfaches Esc bleibt bei claude (abbrechen, zurueckspringen).
    if (e.shiftKey && e.key === "Escape") return false;
    if (!e.ctrlKey) return true;
    const key = e.key.toLowerCase();
    // false = xterm ignoriert das Event, es blubbert zum App-Handler am window.
    if (e.shiftKey && key === "w") return false;
    if (e.shiftKey && key === "c") {
      const text = term!.getSelection();
      if (!text) return true;
      navigator.clipboard.writeText(text);
    } else if (key === "v") {
      navigator.clipboard.readText().then(async (t) => {
        if (!t) await grabClipboard();
        term?.paste(t);
      });
    } else {
      return true;
    }
    // Sonst feuert zusaetzlich das native paste-Event und es kommt doppelt an.
    e.preventDefault();
    return false;
  }

  onMount(() => {
    // Listener vor pty_open, damit kein frueher Output verloren geht.
    unlisten = [
      listen<number[]>(`pty:${id}`, (e) => {
        const b = new Uint8Array(e.payload);
        term?.write(b);
        claim(b);
      }),
      listen(`pty-exit:${id}`, () => onexit()),
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type !== "drop" || !visible || !e.payload.paths.length) return;
        term?.paste(e.payload.paths.map(quote).join(" ") + " ");
        term?.focus();
      }),
    ];
    // Farben aus der App; Hintergrund transparent, damit er von der Seite kommt.
    const css = getComputedStyle(document.documentElement);
    const t = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: "bar",
      // Unfokussiert sonst ein Umriss-Kasten ueber dem Zeichen (v. a. auf dem Mac auffaellig).
      cursorInactiveStyle: "none",
      linkHandler: LINKS,
      fontFamily: css.getPropertyValue("--font-mono") || "monospace",
      fontSize: 13,
      ...base,
      fontWeightBold: "600",
      scrollback: 10000,
      smoothScrollDuration: 90,
      drawBoldTextInBrightColors: false,
      // Live-Wechsel nur, wenn claude mitzieht (notify), sonst bliebe sein Text in den alten Farben unlesbar.
      theme: theme.dark ? DARK : LIGHT,
    });
    term = t;
    screens.set(id, () => {
      const b = t.buffer.active;
      return Array.from({ length: t.rows }, (_, i) => b.getLine(b.viewportY + i)?.translateToString(true) ?? "").join("\n");
    });
    t.loadAddon(fit);
    // "[Image #n]" aus claudes Eingabe-Echo: Klick zeigt das eingefuegte Bild im Aktivitaets-Panel.
    t.registerLinkProvider({
      provideLinks: (y, cb) => {
        const line = t.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        const links = [...line.matchAll(/\[Image #(\d+)\]/g)].map((m) => ({
          text: m[0],
          range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
          activate: () => (pasted.req = { id, n: Number(m[1]) }),
        }));
        cb(links.length ? links : undefined);
      },
    });
    t.open(el);
    // Cmd+V: Bilddaten liegen nur im paste-Event, claude holt sich das Bild selbst aus der Zwischenablage.
    el.addEventListener("paste", (e) => grab([...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile()), true);
    // Der DOM-Renderer nimmt Block- und Linienzeichen aus der Schrift: Logo mit Luecken,
    // Trennlinien mit Zacken (Windows). WebGL zeichnet sie selbst, zellfuellend.
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => {
        gl.dispose();
        webgl = false;
        Object.assign(t.options, base);
      });
      t.loadAddon(gl);
      webgl = true;
    } catch {
      // Kein WebGL2: DOM-Renderer bleibt.
    }
    snap();
    fit.fit();
    // Anderer Monitor/andere Skalierung bei gleicher Fenstergroesse: kein ResizeObserver, aber neue DPR.
    // Nach open() angemeldet, also nach xterms eigenem Listener (misst neu); endet mit dem Terminal.
    (t as any)._core?._coreBrowserService?.onDprChange(refit);
    t.attachCustomKeyEventHandler(onKeyEvent);
    // Trackpad unter macOS: Im Verlauf teilt xterms Scrollable die Deltas und glaettet je nach
    // Heuristik, fuer Maus-Apps/Alt-Screen drosselt xterm Deltas < 50 px auf 30 %. Langsam wischen
    // kriecht, schnell rast. Darum selbst: Verlauf 1:1 in Pixeln, sonst ein Event je Zeilenhoehe Weg.
    // claude erkennt xterm.js nicht (kein XTVERSION) und scrollt je Wheel-Meldung genau eine Zeile;
    // xterm meldet je Event genau einmal. 50 px Delta je Event umgehen xterms 30-%-Drossel.
    // Capture auf dem Container, sonst hat xterms Scrollable das Event schon.
    let wheelPx = 0;
    if (navigator.userAgent.includes("Mac")) {
      el.addEventListener(
        "wheel",
        (e) => {
          if (!e.isTrusted || e.ctrlKey || !e.deltaY || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;
          e.preventDefault();
          e.stopPropagation();
          if (t.modes.mouseTrackingMode === "none" && t.buffer.active.type === "normal") {
            // scrollLines nimmt Bruchteile, Viewport rechnet in Pixel zurueck.
            t.scrollLines(e.deltaY / (el.clientHeight / t.rows));
            return;
          }
          // Richtungswechsel: Rest der alten Richtung verwerfen, sonst reagiert die Umkehr verzoegert.
          if (Math.sign(wheelPx) !== Math.sign(e.deltaY)) wheelPx = 0;
          wheelPx += e.deltaY;
          const line = el.clientHeight / t.rows;
          if (!(line > 0)) return;
          while (Math.abs(wheelPx) >= line) {
            wheelPx -= Math.sign(wheelPx) * line;
            const deltaY = Math.sign(e.deltaY) * 50;
            const { clientX, clientY } = e;
            e.target?.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }));
          }
        },
        { capture: true, passive: false },
      );
    }
    // ConPTY schickt vorab nur Steuersequenzen; erst sichtbarer Text heisst, claude ist da.
    const ready = t.onWriteParsed(() => {
      const b = t.buffer.active;
      for (let y = 0; y < b.length; y++) {
        if (b.getLine(y)?.translateToString(true).trim()) {
          booting = false;
          ready.dispose();
          return;
        }
      }
    });
    // Berechtigungsmodus aus der Fusszeile von claude (untere Bildschirmzeilen); unbekannt (Dialog offen) behaelt den letzten.
    t.onWriteParsed(() => {
      const b = t.buffer.active;
      const end = b.baseY + t.rows;
      const lines = [];
      for (let y = Math.max(0, end - 10); y < end; y++) lines.push(b.getLine(y)?.translateToString(true) ?? "");
      const m = modeOf(lines);
      if (m) onmode?.(m);
    });
    t.onData((data) => invoke("pty_write", { id, data }).catch(() => {}));
    const mode2031 = (on: boolean) => (p: (number | number[])[]) => {
      if (p.includes(2031)) notify = on;
      return false;
    };
    t.parser.registerCsiHandler({ prefix: "?", final: "h" }, mode2031(true));
    t.parser.registerCsiHandler({ prefix: "?", final: "l" }, mode2031(false));
    t.focus();

    const { cols, rows } = t;
    Promise.all(unlisten)
      .then(() => (dead ? undefined : invoke("pty_open", { id, cwd, cols, rows, theme: theme.dark ? "dark" : "light" })))
      .then(() => {
        if (dead) return invoke("pty_close", { id });
        sent = `${cols}x${rows}`;
        refit();
      })
      .catch((e) => dead || t.write(`\x1b[31m${e}\x1b[0m\r\n`));

    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (visible && term) {
      refit();
      term.focus();
    }
  });

  // App-Theme gewechselt: Farben tauschen und claude den Wechsel melden (CSI ?997;1|2n), es fragt dann per
  // OSC 11 den neuen Hintergrund ab und faerbt um. Ohne notify (eigenes Theme) bleibt die Sitzung wie gestartet.
  $effect(() => {
    const dark = theme.dark;
    if (!term || !notify) return;
    term.options.theme = dark ? DARK : LIGHT;
    invoke("pty_write", { id, data: `\x1b[?997;${dark ? 1 : 2}n` }).catch(() => {});
  });

  onDestroy(() => {
    dead = true;
    for (const u of unlisten) u.then((f) => f());
    invoke("pty_close", { id }).catch(() => {});
    term?.dispose();
    screens.delete(id);
    for (const m of Object.values(pasted.local[id] ?? {})) URL.revokeObjectURL(m.url);
    delete pasted.local[id];
  });
</script>

<!-- ponytail: kein Scrollback ueber Neustart, Output lebt nur im xterm-Buffer. -->
<div class="h-full p-2 {visible ? '' : 'hidden'}">
  <!-- Dezenter Primary-Schimmer, scheint durchs transparente Terminal. -->
  <div
    class="bg-card glow h-full overflow-hidden rounded-xl px-3 py-2.5 shadow-lg ring-1 shadow-black/10 dark:shadow-black/30 ring-foreground/5 transition-shadow duration-300 focus-within:ring-primary/40 focus-within:shadow-primary/10"
  >
    <div class="relative h-full">
      <div bind:this={el} class="h-full"></div>
      {#if booting}<ClaudeLoader />{/if}
    </div>
  </div>
</div>

<style>
  /* xterm.css gibt dem Viewport schwarz, das verdeckt den Verlauf. */
  :global(.xterm .xterm-viewport) {
    background-color: transparent !important;
  }
</style>
