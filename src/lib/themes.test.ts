import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, fit, fromHex, hex, over, toGamut } from "./color.ts";
import { DEFAULTS, PRESETS, TOKENS, blankTheme, derive, gradientCss, origin, parseTheme, terminalColors, themeCss } from "./themes.ts";

test("color: hex round trip and WCAG extremes", () => {
  for (const h of ["#7046cf", "#000000", "#ffffff", "#e8be62", "#181b21"]) assert.equal(hex(fromHex(h)!), h);
  assert.equal(fromHex("#abc") && hex(fromHex("#abc")!), "#aabbcc");
  assert.equal(fromHex("red"), undefined);
  assert.ok(Math.abs(contrast(fromHex("#000")!, fromHex("#fff")!) - 21) < 1e-6);
  assert.equal(hex({ l: 0.5, c: 0, h: 0 }, 0.25).length, 9);
});

test("color: out-of-gamut colors map in by chroma, keeping lightness", () => {
  const g = toGamut({ l: 0.7, c: 0.4, h: 150 });
  assert.ok(g.c < 0.4 && g.c > 0.1);
  assert.equal(g.l, 0.7);
});

test("color: fit moves just far enough, in the right direction", () => {
  const dark = { l: 0.2, c: 0.01, h: 265 };
  const f = fit({ l: 0.4, c: 0.1, h: 20 }, [dark], 4.5);
  assert.ok(f.l > 0.4 && contrast(f, dark) >= 4.5 && contrast(f, dark) < 4.6);
  const light = { l: 0.98, c: 0, h: 0 };
  const g = fit({ l: 0.8, c: 0.1, h: 20 }, [light], 4.5);
  assert.ok(g.l < 0.8 && contrast(g, light) >= 4.5);
  const ok = { l: 0.9, c: 0, h: 0 };
  assert.equal(fit(ok, [dark], 4.5), ok);
});

test("color: over blends toward the top color by alpha", () => {
  const black = fromHex("#000")!;
  const white = fromHex("#fff")!;
  assert.equal(hex(over(white, 0, black)), "#000000");
  assert.equal(hex(over(white, 1, black)), "#ffffff");
  // 127.5 per channel: either rounding is right.
  assert.match(hex(over(white, 0.5, black)), /^#(7f7f7f|808080)$/);
});

test("derive: the built-in theme reproduces app.css exactly", () => {
  for (const dark of [false, true]) {
    const got = derive(PRESETS[0], dark);
    const want = dark ? DEFAULTS.dark : DEFAULTS.light;
    for (const k of TOKENS) {
      for (const ch of ["l", "c", "h"] as const) assert.ok(Math.abs(got[k][ch] - want[k][ch]) < 1e-9, `${dark ? "dark" : "light"} ${k}.${ch}: ${got[k][ch]} vs ${want[k][ch]}`);
    }
  }
  assert.equal(themeCss(PRESETS[0]), "");
  assert.equal(terminalColors(PRESETS[0], true), undefined);
});

test("derive: colors follow their parent until set, own colors are used exactly", () => {
  const card = fromHex("#123456")!;
  const th = blankTheme("x", "X");
  th.colors.dark = { card };
  const v = derive(th, true);
  for (const k of ["terminal", "activity", "files", "editor", "popover"] as const) assert.deepEqual(v[k], card, k);
  assert.equal(origin(th, true, "terminal"), "follows");
  // Built-in value until the parent changes.
  assert.deepEqual(v.muted, DEFAULTS.dark.muted);
  assert.equal(origin(th, true, "muted"), "default");
  th.colors.dark.secondary = fromHex("#222222")!;
  assert.deepEqual(derive(th, true).muted, th.colors.dark.secondary);
  // No contrast correction: unreadable on purpose stays unreadable.
  th.colors.dark.foreground = card;
  assert.deepEqual(derive(th, true).foreground, card);
  assert.equal(origin(th, true, "foreground"), "own");
  // The other mode is untouched.
  assert.deepEqual(derive(th, false).card, DEFAULTS.light.card);
});

test("themeCss: derived variables only when the theme sets them, so the rest follows in CSS", () => {
  const th = blankTheme("x", "X");
  th.colors.dark = { card: fromHex("#123456")! };
  assert.ok(!themeCss(th).includes("--terminal:"));
  th.colors.dark.terminal = fromHex("#000000")!;
  const s = themeCss(th);
  assert.match(s, /:root\.dark\{[^}]*--terminal:oklch\(0 0 0\);/);
  assert.ok(!/:root:not\(\.dark\)\{[^}]*--terminal:/.test(s));
});

test("code schemes: scheme colors apply, own colors win", () => {
  const th = blankTheme("x", "X");
  th.code = "clear";
  assert.equal(origin(th, true, "syn-keyword"), "scheme");
  assert.notDeepEqual(derive(th, true)["syn-keyword"], DEFAULTS.dark.primary);
  assert.ok(themeCss(th).includes("--syn-keyword:"));
  const own = fromHex("#ff0000")!;
  th.colors.dark["syn-keyword"] = own;
  assert.deepEqual(derive(th, true)["syn-keyword"], own);
  th.code = "theme";
  delete th.colors.dark["syn-keyword"];
  assert.deepEqual(derive(th, true)["syn-keyword"], DEFAULTS.dark.primary);
});

test("OLED: black background and terminal in dark mode, built-in colors in light mode", () => {
  const oled = PRESETS.find((p) => p.id === "oled")!;
  assert.equal(hex(derive(oled, true).background), "#000000");
  assert.equal(terminalColors(oled, true)!.background, "#00000000");
  assert.deepEqual(derive(oled, false).background, DEFAULTS.light.background);
});

test("terminalColors: own ANSI colors and text are used exactly", () => {
  const th = blankTheme("x", "X");
  th.colors.dark = { "ansi-red": fromHex("#ff0000")!, "term-text": fromHex("#abcdef")! };
  const term = terminalColors(th, true)!;
  assert.equal(term.red, "#ff0000");
  assert.equal(term.foreground, "#abcdef");
  for (const v of Object.values(term)) assert.match(v, /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
});

test("parseTheme: version 1 themes are converted with their look kept", () => {
  const forest = PRESETS.find((p) => p.id === "forest")!;
  const old = parseTheme({ version: 1, name: "Wald alt", base: { h: 160, c: 0.014 }, accent: { h: 152, c: 0.13 }, accent2: { h: 110, c: 0.12 } })!;
  assert.equal(old.version, 2);
  assert.deepEqual(old.colors, forest.colors);
  const ov = parseTheme({ version: 1, surface: 50, overrides: { dark: { background: "#101010" } } })!;
  assert.equal(hex(derive(ov, true).background), "#101010");
  assert.notDeepEqual(derive(ov, false).background, DEFAULTS.light.background);
});

test("parseTheme: rejects non-themes, clamps numbers, drops unknown keys", () => {
  assert.equal(parseTheme(null), undefined);
  assert.equal(parseTheme({ name: "x" }), undefined);
  assert.equal(parseTheme({ version: 3 }), undefined);
  const th = parseTheme({
    version: 2,
    id: "../../etc",
    name: "  Nacht  ",
    glow: 900,
    code: "x) url(evil",
    glowAt: "top right; background:url(x)",
    glowRef: "x) url(evil",
    evil: "@import url(x)",
    colors: { dark: { background: "#101010", foreground: "url(x)", nope: "#fff", card: { l: 9, c: 2, h: 400 } } },
    backdrop: { on: true, gradient: { kind: "radial", stops: Array.from({ length: 20 }, (_, i) => ({ color: { ref: "card" }, alpha: 50, pos: i * 5 })) } },
  })!;
  assert.notEqual(th.id, "../../etc");
  assert.equal(th.name, "Nacht");
  assert.equal(th.glow, 30);
  assert.equal(th.code, "theme");
  assert.equal(th.glowAt, "top right");
  assert.equal(th.glowRef, "primary");
  assert.equal("evil" in th, false);
  assert.deepEqual(Object.keys(th.colors.dark).sort(), ["background", "card"]);
  assert.deepEqual(th.colors.dark.card, { l: 1, c: 0.4, h: 40 });
  assert.equal(th.backdrop.gradient.stops.length, 8);
});

test("themeCss: only generated values, no url() or injected rules from imported text", () => {
  const th = parseTheme({
    version: 1,
    name: "} body { background: url(https://evil) } :root {",
    backdrop: { on: true, gradient: { kind: "conic", angle: "90deg; x", stops: [{ color: "#ff0000", alpha: 50, pos: 0 }, { color: { ref: "primary-2" }, alpha: 0, pos: 100 }] } },
  })!;
  const s = themeCss(th);
  assert.ok(!/url\(|@import|evil/.test(s));
  assert.equal(s.split("{").length, s.split("}").length);
  assert.equal(s.match(/\{/g)!.length, 3);
});

test("gradientCss: the three kinds and interpolation spaces", () => {
  const stops = [
    { color: { ref: "primary" as const }, alpha: 20, pos: 0 },
    { color: { l: 0.5, c: 0.1, h: 30 }, alpha: 100, pos: 100 },
  ];
  assert.equal(
    gradientCss({ kind: "linear", angle: 90, x: 0, y: 0, space: "oklch", stops }),
    "linear-gradient(90deg in oklch, color-mix(in oklab, var(--primary) 20%, transparent) 0%, oklch(0.5 0.1 30) 100%)",
  );
  assert.match(gradientCss({ kind: "radial", angle: 0, x: 100, y: 0, space: "longer", stops }), /^radial-gradient\(ellipse at 100% 0% in oklch longer hue, /);
  assert.match(gradientCss({ kind: "conic", angle: 45, x: 50, y: 50, space: "oklab", stops }, false), /^conic-gradient\(from 45deg at 50% 50%, /);
  // Stops are emitted in position order.
  assert.match(gradientCss({ kind: "linear", angle: 0, x: 0, y: 0, space: "oklab", stops: [...stops].reverse() }), /oklch\(0.5 0.1 30\) 100%\)$/);
});
