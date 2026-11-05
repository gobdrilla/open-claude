#!/usr/bin/env node
// Drives the running dev app (npm run tauri dev) through src-tauri/src/devbridge.rs: DOM events in the webview,
// no OS mouse, keyboard or window focus. Steps are chained with "--" and run in one process:
//   node scripts/ui.mjs snap -- click "text=Einstellungen" -- wait "text=Theme" -- snap dialog
// Targets: @e12 (ref from snap), text=Label (visible text), label=Name (aria-label/title/placeholder), or a CSS selector.
// Commands: snap [target], click|dbl|right|hover <target>, fill|type <target> <text>, press <key> [target],
//   wait|gone <target> [ms], text <target>, term <target> <text>, eval <js body>, shot <file.png>, size <w> <h>,
//   reload, sleep <ms>.
// Text escapes in fill/type/term: \n \r \t \e (Escape). Keys: Enter, Escape, Mod+k (Mod = Cmd on macOS, Ctrl elsewhere).
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function bridge() {
  const dirs = [process.env.OCUI_BRIDGE_DIR, tmpdir()];
  if (process.platform === "darwin") dirs.push(execFileSync("getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim());
  for (const d of dirs.filter(Boolean)) {
    const f = join(d, "ocui-dev-bridge.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  throw new Error("Bridge file missing: is the dev app running (npm run tauri dev)?");
}

const B = bridge();
async function post(path, body = "") {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${B.port}${path}`, { method: "POST", headers: { Authorization: `Bearer ${B.token}` }, body });
  } catch {
    throw new Error(`Bridge not reachable on port ${B.port}: dev app stopped or restarted?`);
  }
  const j = await res.json();
  if (!j.ok) throw new Error(typeof j.value === "string" ? j.value : JSON.stringify(j.value));
  return j.value;
}

// Runs inside the webview. Kept as one function so its source can be sent with every step (survives reloads).
function page() {
  const ui = (window.__ui ??= { refs: new Map(), ids: new WeakMap(), n: 0 });
  const mac = /Mac/.test(navigator.platform);
  const hidden = () => document.visibilityState === "hidden";
  // Hidden webview (dev app behind other windows or on another Space): WebKit renders no frames, so rAF callbacks,
  // CSS transitions and animation events never come and closing dialogs or Svelte transitions hang. While hidden:
  // rAF on a timer, CSS motion off, Web Animations end at once (Svelte waits for onfinish, a frame-bound event).
  if (!ui.patched) {
    ui.patched = true;
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => (hidden() ? -setTimeout(() => cb(performance.now()), 16) : raf(cb));
    window.cancelAnimationFrame = (id) => (id < 0 ? clearTimeout(-id) : caf(id));
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...a) {
      const x = animate.apply(this, a);
      if (!hidden()) return x;
      let fn = null;
      Object.defineProperty(x, "onfinish", { get: () => fn, set: (f) => (fn = f), configurable: true });
      x.finish();
      setTimeout(() => fn?.call(x, new Event("finish")), 0);
      return x;
    };
    const st = document.createElement("style");
    st.textContent = "html[data-ui-hidden] *, html[data-ui-hidden] *::before, html[data-ui-hidden] *::after { transition: none !important; animation: none !important; }";
    document.head.append(st);
    const sync = () => document.documentElement.toggleAttribute("data-ui-hidden", hidden());
    document.addEventListener("visibilitychange", sync);
    sync();
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el.isConnected) return false;
    const s = getComputedStyle(el);
    // display: contents has no box of its own (Svelte's root wrapper), its children decide.
    if (s.display === "contents") return true;
    if (!el.getClientRects().length) return false;
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const ref = (el) => {
    let id = ui.ids.get(el);
    if (!id) {
      id = `e${++ui.n}`;
      ui.ids.set(el, id);
      ui.refs.set(id, new WeakRef(el));
    }
    return id;
  };
  const INTERACTIVE =
    "button,a[href],input,textarea,select,summary,[contenteditable=''],[contenteditable=true],[tabindex]:not([tabindex='-1']),[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=switch],[role=radio],[role=slider],[role=combobox],[role=textbox],[role=treeitem],[role=gridcell]";
  const cm = (el) => {
    const root = el.closest?.(".cm-editor") ?? el.querySelector?.(".cm-editor");
    const content = root?.querySelector(".cm-content");
    return content?.cmTile?.root?.view ?? null;
  };
  const term = (el) => {
    for (let e = el; e; e = e.parentElement) if (e.xterm) return e.xterm;
    return [...el.querySelectorAll("*")].find((e) => e.xterm)?.xterm ?? null;
  };

  function all(t) {
    if (t.startsWith("@")) {
      const el = ui.refs.get(t.slice(1))?.deref();
      return el?.isConnected ? [el] : [];
    }
    if (t.startsWith("text=")) {
      const want = norm(t.slice(5)).toLowerCase();
      // Deepest elements whose text contains it (text split over per-letter spans still matches its parent).
      const has = (el) => norm(el.textContent).toLowerCase().includes(want);
      const hits = [];
      const walk = (el) => {
        let child = false;
        for (const c of el.children) if (has(c)) child = walk(c) || child;
        if (!child && visible(el) && norm(el.innerText).toLowerCase().includes(want)) hits.push(el);
        return child || hits.at(-1) === el;
      };
      if (has(document.body)) walk(document.body);
      // Exact matches first, so "Theme" prefers the button over a longer paragraph.
      const score = (el) => (norm(el.innerText).toLowerCase() === want ? 0 : 1);
      return hits.sort((a, b) => score(a) - score(b));
    }
    if (t.startsWith("label=")) {
      const want = norm(t.slice(6)).toLowerCase();
      return [...document.querySelectorAll("[aria-label],[title],[placeholder]")].filter(
        (el) => visible(el) && [el.ariaLabel, el.title, el.placeholder].some((v) => norm(v).toLowerCase() === want),
      );
    }
    return [...document.querySelectorAll(t)].filter(visible);
  }
  function one(t) {
    const els = all(t);
    if (!els.length) throw new Error(`not found: ${t}`);
    return els[0];
  }
  const actionable = (el) => el.closest(INTERACTIVE) ?? el;

  function center(el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  }
  function mouse(el, type, extra = {}) {
    const o = { bubbles: true, cancelable: true, composed: true, view: window, pointerId: 1, pointerType: "mouse", isPrimary: true, ...center(el), ...extra };
    const E = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    return el.dispatchEvent(new E(type, o));
  }
  function hover(el) {
    for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) mouse(el, t);
  }
  function click(el, button = 0, count = 1) {
    hover(el);
    for (let i = 1; i <= count; i++) {
      const b = { button, buttons: button === 2 ? 2 : 1 };
      if (mouse(el, "pointerdown", b) && mouse(el, "mousedown", { ...b, detail: i })) (el.closest("[tabindex],button,a,input,textarea,select") ?? el).focus?.({ preventScroll: true });
      if (button === 2) mouse(el, "contextmenu", { button: 2, buttons: 0 });
      mouse(el, "pointerup", { button, buttons: 0 });
      mouse(el, "mouseup", { button, buttons: 0, detail: i });
      if (button === 0) mouse(el, "click", { button: 0, buttons: 0, detail: i });
    }
    if (count === 2) mouse(el, "dblclick", { button: 0, buttons: 0, detail: 2 });
  }

  function key(spec, el) {
    const parts = spec.split("+");
    const k = parts.pop();
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    if (mods.delete("mod")) mods.add(mac ? "meta" : "ctrl");
    const name = { esc: "Escape", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[k.toLowerCase()] ?? k;
    const code = name.length === 1 ? (/[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : /\d/.test(name) ? `Digit${name}` : name === " " ? "Space" : "") : name;
    const o = { key: name, code, bubbles: true, cancelable: true, composed: true, ctrlKey: mods.has("ctrl"), metaKey: mods.has("meta") || mods.has("cmd"), altKey: mods.has("alt"), shiftKey: mods.has("shift") };
    const target = el ?? (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body);
    // A CodeMirror editor takes keys on its content element.
    const t = cm(target)?.contentDOM ?? target;
    const down = t.dispatchEvent(new KeyboardEvent("keydown", o));
    t.dispatchEvent(new KeyboardEvent("keyup", o));
    return down ? "not handled (no preventDefault)" : "handled";
  }

  function write(el, text, replace) {
    const view = cm(el);
    if (view) {
      const s = view.state;
      view.dispatch(replace ? { changes: { from: 0, to: s.doc.length, insert: text }, userEvent: "input.type" } : { ...s.replaceSelection(text), userEvent: "input.type", scrollIntoView: true });
      return;
    }
    const x = term(el);
    if (x) return void x.input(text, true);
    el = el.matches("input,textarea,[contenteditable]") ? el : (el.querySelector("input,textarea,[contenteditable]") ?? el);
    el.focus({ preventScroll: true });
    if (el.isContentEditable) {
      if (replace) el.textContent = "";
      el.append(text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }
    // Native setter: Svelte binds listen to input events, not to the property.
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    set.call(el, replace ? text : el.value + text);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function name(el, own = true) {
    const by = el.getAttribute("aria-labelledby");
    const lab = by && norm(by.split(" ").map((i) => document.getElementById(i)?.innerText).join(" "));
    return norm(el.ariaLabel || lab || el.title || el.alt || el.placeholder || (own ? el.innerText || el.value : "") || "").slice(0, 80);
  }
  function role(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") return { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button" }[el.type] ?? "textbox";
    return { a: "link", button: "button", textarea: "textbox", select: "combobox", summary: "button", dialog: "dialog", h1: "heading", h2: "heading", h3: "heading", h4: "heading", img: "img" }[tag] ?? (el.isContentEditable ? "textbox" : tag);
  }
  function state(el) {
    const s = [];
    if (el.disabled || el.ariaDisabled === "true") s.push("disabled");
    if (el.checked || el.ariaChecked === "true") s.push("checked");
    for (const a of ["selected", "expanded", "pressed"]) if (el.getAttribute(`aria-${a}`) === "true") s.push(a);
    if (el.matches("input:not([type=checkbox]):not([type=radio]),textarea") && el.value) s.push(`value="${el.value.slice(0, 60)}"`);
    if (el.matches("input[type=range]")) s.push(`value=${el.value}`);
    if (el === document.activeElement) s.push("focused");
    return s.length ? ` [${s.join(", ")}]` : "";
  }
  // Accessibility-like outline: interactive elements with refs, dialogs, headings and loose text for context.
  function snap(rootSel) {
    const root = rootSel ? one(rootSel) : document.body;
    const out = [];
    const LIMIT = 600;
    const walk = (el, depth) => {
      if (out.length > LIMIT || !(el instanceof HTMLElement) || !visible(el) || el.getAttribute("aria-hidden") === "true") return;
      const pad = "  ".repeat(depth);
      if (el.xterm) {
        const b = el.xterm.buffer.active;
        const last = Array.from({ length: el.xterm.rows }, (_, i) => b.getLine(b.viewportY + i)?.translateToString(true) ?? "").filter((l) => l.trim()).slice(-3);
        return void out.push(`${pad}- terminal @${ref(el)}: ${JSON.stringify(last.join(" ⏎ ").slice(-160))}`);
      }
      if (el.classList.contains("cm-editor")) {
        const v = cm(el);
        const line = v ? v.state.doc.lineAt(v.state.selection.main.head).number : "?";
        return void out.push(`${pad}- editor @${ref(el)} (${v?.state.doc.lines ?? "?"} lines, cursor line ${line})`);
      }
      const r = role(el);
      const inter = el.matches(INTERACTIVE);
      const landmark = ["dialog", "alertdialog", "menu", "listbox", "tablist", "tree", "heading", "tooltip", "alert"].includes(r);
      let d = depth;
      if (inter || landmark) {
        // Landmarks (tree, tablist, dialog …) only by their label, their text follows as children; headings by their text.
        const leaf = inter || r === "heading";
        out.push(`${pad}- ${r} "${name(el, leaf)}" @${ref(el)}${state(el)}`);
        d++;
        // Children of a button-like leaf only repeat its name.
        if (leaf && !el.querySelector(INTERACTIVE)) return;
      } else if (!el.querySelector(`${INTERACTIVE},.cm-editor,[role=dialog],[role=heading],h1,h2,h3,h4`) && ![...el.querySelectorAll("*")].some((e) => e.xterm)) {
        // Plain subtree: one line (also joins per-letter highlight spans).
        const text = norm(el.innerText);
        if (text) out.push(`${pad}- text "${text.slice(0, 100)}"`);
        return;
      } else {
        const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
        if (own) out.push(`${pad}- text "${own.slice(0, 100)}"`);
      }
      for (const c of el.children) walk(c, d);
    };
    walk(root, 0);
    if (out.length > LIMIT) out.push(`… cut at ${LIMIT} lines, snap a smaller target`);
    return out.join("\n");
  }

  async function wait(t, ms, gone) {
    for (const end = Date.now() + ms; ; await sleep(40)) {
      if (!!all(t).length !== gone) return "ok";
      if (Date.now() > end) throw new Error(`${gone ? "still there" : "not found"} after ${ms} ms: ${t}`);
    }
  }
  // Lets Svelte effects and fetches triggered by the event run before the next step.
  const settle = () => sleep(30);

  const unesc = (s) => s.replace(/\\(n|r|t|e)/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", e: "\x1b" })[c]);
  const note = (t) => (t.startsWith("@") || all(t).length < 2 ? "" : ` (${all(t).length} matches, took first)`);
  return {
    async snap(t) {
      return snap(t);
    },
    async click(t) {
      click(actionable(one(t)));
      await settle();
      return "ok" + note(t);
    },
    async dbl(t) {
      click(actionable(one(t)), 0, 2);
      await settle();
      return "ok" + note(t);
    },
    async right(t) {
      click(one(t), 2);
      await settle();
      return "ok" + note(t);
    },
    async hover(t) {
      hover(one(t));
      await settle();
      return "ok";
    },
    async fill(t, text) {
      write(one(t), unesc(text), true);
      await settle();
      return "ok";
    },
    async type(t, text) {
      write(one(t), unesc(text), false);
      await settle();
      return "ok";
    },
    async term(t, text) {
      const x = term(one(t));
      if (!x) throw new Error(`no terminal at ${t}`);
      x.input(unesc(text), true);
      return "ok";
    },
    async press(k, t) {
      const r = key(k, t ? one(t) : undefined);
      await settle();
      return r;
    },
    async wait(t, ms = "5000") {
      return wait(t, Number(ms), false);
    },
    async gone(t, ms = "5000") {
      return wait(t, Number(ms), true);
    },
    async text(t) {
      const el = one(t);
      const v = cm(el);
      if (v) return v.state.doc.toString();
      const x = term(el);
      if (x) {
        const b = x.buffer.active;
        return Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) ?? "").join("\n").trimEnd();
      }
      return el.innerText;
    },
  };
}

const ARITY = { snap: [0, 1], click: [1, 1], dbl: [1, 1], right: [1, 1], hover: [1, 1], fill: [2, 2], type: [2, 2], term: [2, 2], press: [1, 2], wait: [1, 2], gone: [1, 2], text: [1, 1], eval: [1, 1], shot: [1, 1], size: [2, 2], reload: [0, 0], sleep: [1, 1] };

function steps(argv) {
  const out = [[]];
  for (const a of argv) a === "--" ? out.push([]) : out.at(-1).push(a);
  return out.filter((s) => s.length).map(([cmd, ...args]) => {
    const r = ARITY[cmd];
    if (!r) throw new Error(`unknown command: ${cmd}`);
    if (args.length < r[0] || args.length > r[1]) throw new Error(`${cmd}: expects ${r[0]}–${r[1]} arguments, got ${args.length}`);
    return { cmd, args };
  });
}

// macOS: window id of the app process for screencapture -l (works while covered; needs Screen Recording permission).
function windowId(pid) {
  const js = `ObjC.import('CoreGraphics');const l=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll,0)));
const w=l.filter(w=>w.kCGWindowOwnerPID===${pid}&&w.kCGWindowLayer===0&&w.kCGWindowBounds.Height>200).sort((a,b)=>b.kCGWindowBounds.Width*b.kCGWindowBounds.Height-a.kCGWindowBounds.Width*a.kCGWindowBounds.Height)[0];w?w.kCGWindowNumber:''`;
  const id = execFileSync("osascript", ["-l", "JavaScript", "-e", js], { encoding: "utf8" }).trim();
  if (!id) throw new Error(`no window for pid ${pid}`);
  return id;
}

async function run({ cmd, args }) {
  if (cmd === "eval") return post("/eval", args[0]);
  if (cmd === "size") return post(`/size?w=${args[0]}&h=${args[1]}`).then(() => "ok");
  if (cmd === "sleep") return new Promise((r) => setTimeout(() => r("ok"), Number(args[0])));
  if (cmd === "shot") {
    if (process.platform !== "darwin") throw new Error("shot: macOS only so far");
    execFileSync("screencapture", ["-x", "-o", "-l", windowId(B.pid), args[0]]);
    return args[0];
  }
  if (cmd === "reload") {
    await post("/eval", "window.__uiOld = true; setTimeout(() => location.reload(), 0); return 'ok'");
    // The bridge answers only once the new page runs JS again.
    for (const end = Date.now() + 20000; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
      try {
        if (await post("/eval", "return !window.__uiOld && document.readyState === 'complete' && !!document.querySelector('button')")) return "ok";
      } catch {}
    }
    throw new Error("reload: page not ready after 20 s");
  }
  return post("/eval", `return (${page.toString()})()[${JSON.stringify(cmd)}](...${JSON.stringify(args)});`);
}

const list = (() => {
  try {
    return steps(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
})();
if (!list.length) {
  console.error(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).join("\n"));
  process.exit(2);
}
for (const s of list) {
  const t0 = Date.now();
  try {
    const v = await run(s);
    const text = typeof v === "string" ? v : JSON.stringify(v, null, 1);
    console.log(list.length > 1 ? `$ ${s.cmd} ${s.args.join(" ")}  (${Date.now() - t0} ms)\n${text}` : text);
  } catch (e) {
    console.error(`$ ${s.cmd} ${s.args.join(" ")}: ERROR ${e.message}`);
    process.exit(1);
  }
}
