// User themes: a few seeds (base tint, accent, surface, contrast, gradients) derive every color token of app.css
// for light and dark. Pure functions (no DOM), so node tests cover them; the store is themes.svelte.ts.
// Security: themes are imported from text, so CSS is only ever built here from clamped numbers and enum values,
// never from strings out of the theme file (no url(), no free CSS).
import { contrast, css, fit, fromHex, hex, over, type Oklch } from "./color.ts";
import { t } from "./i18n.ts";

export type { Oklch } from "./color.ts";

/** Tokens a theme derives or overrides (app.css names without "--"). */
export const TOKENS = [
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "primary-foreground",
  "secondary",
  "muted",
  "muted-foreground",
  "accent",
  "destructive",
  "border",
  "input",
  "ring",
  "chrome",
  "success",
  "warning",
  "info",
  "syn-string",
  "syn-regexp",
  "syn-number",
  "syn-type",
  "syn-fn",
  "syn-prop",
  "syn-meta",
  "syn-const",
  "bracket-1",
  "bracket-2",
  "bracket-3",
] as const;
export type Token = (typeof TOKENS)[number];
export type Tokens = Record<Token, Oklch>;

const o = (l: number, c: number, h: number): Oklch => ({ l, c, h });

/** The hand-tuned values of app.css. Seeds equal to ATELIER reproduce them (test). */
export const DEFAULTS: { light: Tokens; dark: Tokens } = {
  light: {
    background: o(0.985, 0.003, 265),
    foreground: o(0.24, 0.016, 265),
    card: o(0.995, 0.002, 265),
    popover: o(0.995, 0.002, 265),
    primary: o(0.52, 0.2, 292),
    "primary-foreground": o(0.985, 0.006, 292),
    secondary: o(0.955, 0.006, 265),
    muted: o(0.955, 0.006, 265),
    "muted-foreground": o(0.5, 0.02, 265),
    accent: o(0.935, 0.02, 285),
    destructive: o(0.53, 0.19, 22),
    border: o(0.905, 0.008, 265),
    input: o(0.87, 0.01, 265),
    ring: o(0.52, 0.2, 292),
    chrome: o(0.958, 0.005, 265),
    success: o(0.5, 0.13, 150),
    warning: o(0.51, 0.11, 70),
    info: o(0.5, 0.12, 245),
    "syn-string": o(0.5, 0.13, 150),
    "syn-regexp": o(0.5, 0.085, 190),
    "syn-number": o(0.53, 0.13, 55),
    "syn-type": o(0.5, 0.095, 225),
    "syn-fn": o(0.5, 0.1, 85),
    "syn-prop": o(0.48, 0.12, 255),
    "syn-meta": o(0.5, 0.12, 320),
    "syn-const": o(0.52, 0.12, 30),
    "bracket-1": o(0.57, 0.12, 75),
    "bracket-2": o(0.55, 0.18, 330),
    "bracket-3": o(0.53, 0.16, 250),
  },
  dark: {
    background: o(0.19, 0.012, 265),
    foreground: o(0.93, 0.008, 265),
    card: o(0.22, 0.013, 265),
    popover: o(0.22, 0.013, 265),
    primary: o(0.72, 0.14, 292),
    "primary-foreground": o(0.17, 0.02, 292),
    secondary: o(0.26, 0.014, 265),
    muted: o(0.26, 0.014, 265),
    "muted-foreground": o(0.65, 0.016, 265),
    accent: o(0.28, 0.02, 275),
    destructive: o(0.68, 0.17, 22),
    border: o(0.29, 0.014, 265),
    input: o(0.29, 0.014, 265),
    ring: o(0.72, 0.14, 292),
    chrome: o(0.165, 0.012, 265),
    success: o(0.76, 0.13, 150),
    warning: o(0.82, 0.12, 85),
    info: o(0.78, 0.1, 210),
    "syn-string": o(0.78, 0.11, 150),
    "syn-regexp": o(0.78, 0.11, 190),
    "syn-number": o(0.78, 0.12, 60),
    "syn-type": o(0.8, 0.1, 215),
    "syn-fn": o(0.83, 0.1, 95),
    "syn-prop": o(0.8, 0.08, 250),
    "syn-meta": o(0.8, 0.1, 320),
    "syn-const": o(0.8, 0.1, 30),
    "bracket-1": o(0.86, 0.14, 92),
    "bracket-2": o(0.74, 0.16, 328),
    "bracket-3": o(0.72, 0.14, 245),
  },
};

/** Theme colors a gradient stop can follow, so gradients move with the accent. */
export const REFS = ["primary", "primary-2", "background", "card", "foreground", "muted", "success", "warning", "info", "destructive"] as const;
export type Ref = (typeof REFS)[number];
export type StopColor = { ref: Ref } | Oklch;
export type Stop = { color: StopColor; alpha: number; pos: number };
export const KINDS = ["linear", "radial", "conic"] as const;
export const SPACES = ["oklab", "oklch", "longer"] as const;
export type Gradient = { kind: (typeof KINDS)[number]; angle: number; x: number; y: number; space: (typeof SPACES)[number]; stops: Stop[] };
export const GLOW_AT = ["top right", "top left", "top", "bottom right", "bottom left"] as const;

export type Theme = {
  version: 1;
  id: string;
  name: string;
  /** Tint of the neutral surfaces and text; c 0 = pure gray. */
  base: { h: number; c: number };
  /** Accent (primary); its lightness is chosen per mode for contrast. */
  accent: { h: number; c: number };
  /** Second accent, end of the primary gradient (buttons, logo); null = accent fading out. */
  accent2: { h: number; c: number } | null;
  /** -100 (deeper) .. 100 (lighter) surfaces. */
  surface: number;
  /** 0..100, 50 = like the built-in theme. Never drops text below WCAG AA. */
  contrast: number;
  /** Glow on cards and dialogs, % of the glow color. */
  glow: number;
  glowAt: (typeof GLOW_AT)[number];
  glowRef: Ref;
  /** Gradient behind the app (visible between panels and in the project list). */
  backdrop: { on: boolean; strength: number; gradient: Gradient };
  /** Film grain over the backdrop against banding, 0..100. */
  grain: number;
  /** Exact colors per mode, after derivation (advanced). */
  overrides: { light: Partial<Tokens>; dark: Partial<Tokens> };
};

export const MAX_STOPS = 8;
const ATELIER_ID = "atelier";

const base = (over: Partial<Theme> & Pick<Theme, "id" | "name">): Theme => ({
  version: 1,
  base: { h: 265, c: 0.012 },
  accent: { h: 292, c: 0.14 },
  accent2: null,
  surface: 0,
  contrast: 50,
  glow: 8,
  glowAt: "top right",
  glowRef: "primary",
  backdrop: { on: false, strength: 60, gradient: { kind: "radial", angle: 135, x: 100, y: 0, space: "oklab", stops: [{ color: { ref: "primary" }, alpha: 18, pos: 0 }, { color: { ref: "primary" }, alpha: 0, pos: 70 }] } },
  grain: 0,
  overrides: { light: {}, dark: {} },
  ...over,
});

/** Built-in themes; "atelier" is app.css itself (no generated CSS). */
export const PRESETS: Theme[] = [
  base({ id: ATELIER_ID, name: "Atelier" }),
  base({
    id: "midnight",
    name: t("Mitternacht"),
    base: { h: 255, c: 0.02 },
    accent: { h: 245, c: 0.15 },
    accent2: { h: 200, c: 0.12 },
    surface: -40,
    glow: 12,
    backdrop: {
      on: true,
      strength: 70,
      gradient: { kind: "radial", angle: 0, x: 15, y: 0, space: "oklch", stops: [{ color: { ref: "primary" }, alpha: 22, pos: 0 }, { color: { ref: "primary-2" }, alpha: 8, pos: 40 }, { color: { ref: "background" }, alpha: 0, pos: 80 }] },
    },
  }),
  base({
    id: "forest",
    name: t("Wald"),
    base: { h: 160, c: 0.014 },
    accent: { h: 152, c: 0.13 },
    accent2: { h: 110, c: 0.12 },
    glow: 10,
    glowAt: "top left",
    backdrop: {
      on: true,
      strength: 55,
      gradient: { kind: "linear", angle: 160, x: 50, y: 50, space: "oklch", stops: [{ color: { ref: "primary" }, alpha: 16, pos: 0 }, { color: { ref: "background" }, alpha: 0, pos: 55 }] },
    },
    grain: 30,
  }),
  base({
    id: "ember",
    name: t("Glut"),
    base: { h: 40, c: 0.012 },
    accent: { h: 35, c: 0.16 },
    accent2: { h: 75, c: 0.15 },
    glow: 14,
    backdrop: {
      on: true,
      strength: 65,
      gradient: { kind: "conic", angle: 200, x: 100, y: 0, space: "longer", stops: [{ color: { ref: "primary" }, alpha: 16, pos: 0 }, { color: { ref: "primary-2" }, alpha: 10, pos: 50 }, { color: { ref: "primary" }, alpha: 16, pos: 100 }] },
    },
    grain: 40,
  }),
  base({ id: "graphite", name: t("Graphit"), base: { h: 265, c: 0 }, accent: { h: 250, c: 0.06 }, contrast: 75, glow: 0 }),
];

export const isPreset = (id: string) => PRESETS.some((p) => p.id === id);

// --- validation (trust boundary: import and stored data) ---

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const hue = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? ((v % 360) + 360) % 360 : d);

/** OKLCH object or "#rrggbb"; undefined if neither. */
function color(v: unknown): Oklch | undefined {
  if (typeof v === "string") return fromHex(v);
  if (!isObj(v) || typeof v.l !== "number") return undefined;
  return { l: num(v.l, 0, 1, 0.5), c: num(v.c, 0, 0.4, 0), h: hue(v.h, 0) };
}
const hc = (v: unknown, d: { h: number; c: number }) => (isObj(v) ? { h: hue(v.h, d.h), c: num(v.c, 0, 0.4, d.c) } : d);

function stopColor(v: unknown): StopColor {
  if (isObj(v) && "ref" in v) return { ref: pick(v.ref, REFS, "primary") };
  return color(v) ?? { ref: "primary" };
}

function gradient(v: unknown, d: Gradient): Gradient {
  if (!isObj(v)) return d;
  const stops = Array.isArray(v.stops)
    ? v.stops.slice(0, MAX_STOPS).map((s: unknown) => (isObj(s) ? { color: stopColor(s.color), alpha: num(s.alpha, 0, 100, 100), pos: num(s.pos, 0, 100, 0) } : null)).filter((s) => s !== null)
    : [];
  return {
    kind: pick(v.kind, KINDS, d.kind),
    angle: num(v.angle, 0, 360, d.angle),
    x: num(v.x, 0, 100, d.x),
    y: num(v.y, 0, 100, d.y),
    space: pick(v.space, SPACES, d.space),
    stops: stops.length >= 2 ? stops : d.stops,
  };
}

function tokens(v: unknown): Partial<Tokens> {
  const out: Partial<Tokens> = {};
  if (!isObj(v)) return out;
  for (const k of TOKENS) {
    const c = color(v[k]);
    if (c) out[k] = c;
  }
  return out;
}

/** Theme from untrusted JSON: unknown keys dropped, numbers clamped, enums checked. undefined if not a theme. */
export function parseTheme(v: unknown): Theme | undefined {
  if (!isObj(v) || v.version !== 1) return undefined;
  const d = PRESETS[0];
  const bd = isObj(v.backdrop) ? v.backdrop : {};
  return {
    version: 1,
    id: typeof v.id === "string" && /^[\w-]{1,64}$/.test(v.id) ? v.id : newId(),
    name: typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 40) : t("Eigenes Theme"),
    base: hc(v.base, d.base),
    accent: hc(v.accent, d.accent),
    accent2: v.accent2 === null || v.accent2 === undefined ? null : hc(v.accent2, d.accent),
    surface: num(v.surface, -100, 100, 0),
    contrast: num(v.contrast, 0, 100, 50),
    glow: num(v.glow, 0, 30, d.glow),
    glowAt: pick(v.glowAt, GLOW_AT, d.glowAt),
    glowRef: pick(v.glowRef, REFS, d.glowRef),
    backdrop: { on: bd.on === true, strength: num(bd.strength, 0, 100, d.backdrop.strength), gradient: gradient(bd.gradient, d.backdrop.gradient) },
    grain: num(v.grain, 0, 100, 0),
    overrides: isObj(v.overrides) ? { light: tokens(v.overrides.light), dark: tokens(v.overrides.dark) } : { light: {}, dark: {} },
  };
}

export const newId = () => "t" + Math.random().toString(36).slice(2, 10);

// --- derivation ---

const NEUTRAL: Token[] = ["background", "card", "popover", "secondary", "muted", "border", "input", "chrome", "foreground", "muted-foreground"];
const SURFACES: Token[] = ["card", "popover", "secondary", "muted", "accent", "chrome"];
const ACCENTED: Token[] = ["primary", "primary-foreground", "accent", "ring"];
const FIXED: [Token, number][] = [
  ["destructive", 4.5],
  ["success", 4.5],
  ["warning", 4.5],
  ["info", 4.5],
  ["syn-string", 4.5],
  ["syn-regexp", 4.5],
  ["syn-number", 4.5],
  ["syn-type", 4.5],
  ["syn-fn", 4.5],
  ["syn-prop", 4.5],
  ["syn-meta", 4.5],
  ["syn-const", 4.5],
  ["bracket-1", 3],
  ["bracket-2", 3],
  ["bracket-3", 3],
];
const clampL = (l: number) => Math.min(1, Math.max(0, l));

/** All tokens of one mode. Seeds equal to the built-in theme return DEFAULTS unchanged. */
export function derive(th: Theme, dark: boolean): Tokens {
  const D = dark ? DEFAULTS.dark : DEFAULTS.light;
  const ref = PRESETS[0];
  const out = { ...D };
  const k = (th.contrast - 50) / 50; // -1..1
  const bgL = clampL(D.background.l + (th.surface / 100) * (dark ? 0.07 : 0.04));
  // Neutral chroma follows base.c relative to the built-in tint, capped so grays stay gray.
  const tint = ref.base.c ? th.base.c / ref.base.c : 0;
  for (const name of NEUTRAL) out[name] = { l: D[name].l, c: Math.min(0.08, D[name].c * tint), h: th.base.h };
  const cScale = th.accent.c / ref.accent.c;
  for (const name of ACCENTED) out[name] = { l: D[name].l, c: Math.min(0.37, D[name].c * cScale), h: (D[name].h - ref.accent.h + th.accent.h + 360) % 360 };

  // Lightness: everything keeps its distance to the background, scaled by contrast.
  const rel = (name: Token, f: number) => (out[name] = { ...out[name], l: clampL(bgL + (D[name].l - D.background.l) * f) });
  out.background = { ...out.background, l: bgL };
  for (const name of SURFACES) rel(name, 1 + 0.5 * k);
  for (const name of ["border", "input"] as Token[]) rel(name, 1 + 0.8 * k);
  for (const name of ["foreground", "muted-foreground"] as Token[]) rel(name, 1 + 0.25 * k);

  // Guarantees (WCAG 2): text 7:1 / 4.5:1 on every surface it sits on, accent 3:1 as a UI color.
  const surfaces = [out.background, out.card, out.secondary];
  out.foreground = fit(out.foreground, surfaces, 7);
  out["muted-foreground"] = fit(out["muted-foreground"], surfaces, 4.5);
  out.primary = fit(out.primary, [out.background, out.card], 3);
  out.ring = { ...out.ring, l: out.primary.l };
  out["primary-foreground"] = fit(out["primary-foreground"], [out.primary], 4.5);
  for (const [name, ratio] of FIXED) out[name] = fit(D[name], [out.background, out.card], ratio);

  return { ...out, ...(dark ? th.overrides.dark : th.overrides.light) };
}

/** End color of the primary gradient, if the theme has a second accent. */
function primary2(th: Theme, tk: Tokens, dark: boolean): Oklch | undefined {
  if (!th.accent2) return undefined;
  const c = Math.min(0.37, ((dark ? DEFAULTS.dark : DEFAULTS.light).primary.c * th.accent2.c) / PRESETS[0].accent.c);
  return fit({ l: tk.primary.l, c, h: th.accent2.h }, [tk.background, tk.card], 3);
}

const varCss = (r: Ref) => `var(--${r})`;

function stopCss(s: Stop, ref: (r: Ref) => string): string {
  const a = s.alpha / 100;
  if ("ref" in s.color) return `color-mix(in oklab, ${ref(s.color.ref)} ${+(a * 100).toFixed(1)}%, transparent) ${+s.pos.toFixed(1)}%`;
  return `${css(s.color, a)} ${+s.pos.toFixed(1)}%`;
}

/** CSS image for a gradient. `interp` false drops the interpolation method (engines without `in oklch`);
 *  `ref` resolves theme references (default: the live CSS variable). */
export function gradientCss(g: Gradient, interp = true, ref: (r: Ref) => string = varCss): string {
  const space = !interp ? "" : g.space === "oklab" ? " in oklab" : g.space === "oklch" ? " in oklch" : " in oklch longer hue";
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => stopCss(s, ref)).join(", ");
  const at = `at ${+g.x.toFixed(1)}% ${+g.y.toFixed(1)}%`;
  if (g.kind === "linear") return `linear-gradient(${+g.angle.toFixed(1)}deg${space}, ${stops})`;
  if (g.kind === "radial") return `radial-gradient(ellipse ${at}${space}, ${stops})`;
  return `conic-gradient(from ${+g.angle.toFixed(1)}deg ${at}${space}, ${stops})`;
}

/** Stylesheet for a theme ("" for the built-in one: app.css as is). Higher specificity than app.css's :root/.dark. */
export function themeCss(th: Theme, interp = true): string {
  if (th.id === ATELIER_ID) return "";
  const block = (dark: boolean) => {
    const tk = derive(th, dark);
    const p2 = primary2(th, tk, dark);
    return TOKENS.map((name) => `--${name}:${css(tk[name])};`).join("") + (p2 ? `--primary-2:${css(p2)};` : "");
  };
  const root = [`--glow:${+th.glow.toFixed(1)}%`, `--glow-at:${th.glowAt}`, `--glow-color:var(--${th.glowRef})`, `--grain:${+(th.grain / 100).toFixed(3)}`];
  if (th.backdrop.on) root.push(`--backdrop:${gradientCss(th.backdrop.gradient, interp)}`, `--backdrop-opacity:${+(th.backdrop.strength / 100).toFixed(3)}`);
  return `:root:not(.dark){${block(false)}}:root.dark{${block(true)}}:root{${root.join(";")}}`;
}

// --- terminal ---

type Ansi = Record<string, string>;
// Hue per ANSI slot (red stays red: users read it as errors); lightness gets fitted for contrast.
const ANSI: [name: string, l: { dark: number; light: number }, c: number, h: number | "accent"][] = [
  ["red", { dark: 0.72, light: 0.52 }, 0.13, 20],
  ["green", { dark: 0.76, light: 0.5 }, 0.13, 150],
  ["yellow", { dark: 0.82, light: 0.52 }, 0.12, 85],
  ["blue", { dark: 0.72, light: 0.5 }, 0.12, 255],
  ["magenta", { dark: 0.72, light: 0.52 }, 0.14, "accent"],
  ["cyan", { dark: 0.78, light: 0.52 }, 0.1, 210],
];

/** xterm ITheme for a theme, or undefined for the built-in one (termtheme.ts keeps its tuned palette). */
export function terminalColors(th: Theme, dark: boolean): Ansi | undefined {
  if (th.id === ATELIER_ID) return undefined;
  const tk = derive(th, dark);
  const bg = tk.card;
  const out: Ansi = {
    // Alpha 0: see termtheme.ts (WebGL paints attributed cells opaque in this color).
    background: hex(bg, 0),
    foreground: hex(tk.foreground),
    cursor: hex(tk.primary),
    cursorAccent: hex(bg),
    selectionBackground: hex(tk.primary, 0.25),
    black: hex(dark ? tk.secondary : tk.foreground),
    white: hex(fit({ l: dark ? 0.82 : 0.5, c: tk.foreground.c, h: th.base.h }, [bg], 4.5)),
    brightBlack: hex(tk["muted-foreground"]),
    brightWhite: hex(dark ? tk.foreground : tk["muted-foreground"]),
  };
  for (const [name, l, c, h] of ANSI) {
    const col = fit({ l: dark ? l.dark : l.light, c, h: h === "accent" ? tk.primary.h : h }, [bg], 4.5);
    out[name] = hex(col);
    // Bright: further from the background (lighter in dark mode, darker in light mode, see termtheme.ts).
    out["bright" + name[0].toUpperCase() + name.slice(1)] = hex({ ...col, l: clampL(col.l + (dark ? 0.08 : -0.06)), c: col.c * 0.85 });
  }
  return out;
}

// --- report ---

export type Check = { label: string; ratio: number; min: number };

/** Color a theme reference stands for in one mode. */
export function refColor(th: Theme, tk: Tokens, r: Ref, dark: boolean): Oklch {
  return r === "primary-2" ? (primary2(th, tk, dark) ?? tk.primary) : tk[r];
}
const resolve = (c: StopColor, tk: Tokens, th: Theme, dark: boolean) => ("ref" in c ? refColor(th, tk, c.ref, dark) : c);

/** Contrast of the pairs that matter, for the editor (after overrides, which skip the guarantees). */
export function report(th: Theme, dark: boolean): Check[] {
  const tk = derive(th, dark);
  const out: Check[] = [
    { label: t("Text auf Hintergrund"), ratio: contrast(tk.foreground, tk.background), min: 4.5 },
    { label: t("Nebentext auf Karte"), ratio: contrast(tk["muted-foreground"], tk.card), min: 4.5 },
    { label: t("Text auf Akzent"), ratio: contrast(tk["primary-foreground"], tk.primary), min: 4.5 },
    { label: t("Akzent auf Hintergrund"), ratio: contrast(tk.primary, tk.background), min: 3 },
  ];
  if (th.backdrop.on) {
    // Worst stop under the text, never the average (WCAG G18).
    const a = th.backdrop.strength / 100;
    const worst = Math.min(...th.backdrop.gradient.stops.map((s) => contrast(tk.foreground, over(resolve(s.color, tk, th, dark), (s.alpha / 100) * a, tk.background))));
    out.push({ label: t("Text auf Verlauf"), ratio: worst, min: 4.5 });
  }
  return out;
}
