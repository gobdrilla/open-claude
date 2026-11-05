import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, fit, fromHex, hex, over, toGamut } from "./color.ts";
import { DEFAULTS, PRESETS, TOKENS, derive, gradientCss, parseTheme, report, terminalColors, themeCss, type Theme } from "./themes.ts";

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

test("derive: the built-in seeds reproduce app.css exactly", () => {
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

test("derive: any seeds keep text readable (WCAG AA) in both modes", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const themes: Theme[] = [...PRESETS];
  for (let i = 0; i < 300; i++) {
    themes.push({
      ...PRESETS[0],
      id: "r" + i,
      base: { h: rnd() * 360, c: rnd() * 0.1 },
      accent: { h: rnd() * 360, c: rnd() * 0.37 },
      accent2: rnd() < 0.5 ? null : { h: rnd() * 360, c: rnd() * 0.3 },
      surface: rnd() * 200 - 100,
      contrast: rnd() * 100,
    });
  }
  for (const th of themes) {
    for (const dark of [false, true]) {
      for (const c of report(th, dark)) assert.ok(c.ratio >= c.min - 1e-6, `${th.id} ${dark ? "dark" : "light"} ${c.label}: ${c.ratio.toFixed(2)}`);
      const tk = derive(th, dark);
      for (const k of ["success", "warning", "info", "destructive", "syn-fn", "syn-string"] as const) assert.ok(contrast(tk[k], tk.card) >= 4.5 - 1e-6, `${th.id} ${k}`);
      const term = terminalColors(th, dark)!;
      if (th.id !== "atelier") for (const v of Object.values(term)) assert.match(v, /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  }
});

test("derive: contrast slider spreads surfaces and text", () => {
  const lo = derive({ ...PRESETS[0], contrast: 0 }, true);
  const hi = derive({ ...PRESETS[0], contrast: 100 }, true);
  assert.ok(hi.border.l > lo.border.l);
  assert.ok(contrast(hi.foreground, hi.background) > contrast(lo.foreground, lo.background));
});

test("parseTheme: rejects non-themes, clamps numbers, drops unknown keys", () => {
  assert.equal(parseTheme(null), undefined);
  assert.equal(parseTheme({ name: "x" }), undefined);
  assert.equal(parseTheme({ version: 2 }), undefined);
  const th = parseTheme({
    version: 1,
    id: "../../etc",
    name: "  Nacht  ",
    contrast: 900,
    surface: -Infinity,
    accent: { h: 400, c: 2 },
    glowAt: "top right; background:url(x)",
    glowRef: "x) url(evil",
    evil: "@import url(x)",
    overrides: { dark: { background: "#101010", foreground: "url(x)", nope: "#fff" } },
    backdrop: { on: true, gradient: { kind: "radial", stops: Array.from({ length: 20 }, (_, i) => ({ color: { ref: "card" }, alpha: 50, pos: i * 5 })) } },
  })!;
  assert.notEqual(th.id, "../../etc");
  assert.equal(th.name, "Nacht");
  assert.equal(th.contrast, 100);
  assert.equal(th.surface, 0);
  assert.deepEqual(th.accent, { h: 40, c: 0.4 });
  assert.equal(th.glowAt, "top right");
  assert.equal(th.glowRef, "primary");
  assert.equal("evil" in th, false);
  assert.deepEqual(Object.keys(th.overrides.dark), ["background"]);
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
