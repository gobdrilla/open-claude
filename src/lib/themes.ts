// User themes: every color of app.css (plus area, code and terminal colors) per mode, exactly as the user picks it.
// A color the theme leaves out follows its parent (the terminal follows the panels) or keeps the built-in value.
// No contrast correction: what the user picks is what the app shows. Pure functions (no DOM), so node tests cover
// them; the store is themes.svelte.ts.
// Security: themes are imported from text, so CSS is only ever built here from clamped numbers and enum values,
// never from strings out of the theme file (no url(), no free CSS).
import { css, fit, fromHex, hex, over, type Oklch } from "./color.ts";
import { t } from "./i18n.ts";

export type { Oklch } from "./color.ts";

/** app.css tokens with a built-in value (names without "--"). */
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

/** app.css variables whose default comes from other tokens (var() / color-mix): a theme writes them only when set. */
export const EXTRA = [
  "primary-2",
  "terminal",
  "activity",
  "files",
  "editor",
  "code-text",
  "syn-keyword",
  "syn-comment",
  "syn-operator",
  "line-number",
  "current-line",
  "code-selection",
] as const;
/** Terminal colors: xterm takes them from JS (terminalColors), not from CSS. */
export const TERM = ["term-text", "term-cursor", "ansi-red", "ansi-green", "ansi-yellow", "ansi-blue", "ansi-magenta", "ansi-cyan"] as const;
export const IDS = [...TOKENS, ...EXTRA, ...TERM] as const;
export type ColorId = (typeof IDS)[number];
export type Colors = Partial<Record<ColorId, Oklch>>;
export type Palette = Record<ColorId, Oklch>;

/** Parent of a color without its own value; with alpha: mixed over the area it sits on (as the color-mix in app.css). */
const FOLLOWS: Partial<Record<ColorId, [parent: ColorId, alpha?: number, over?: ColorId]>> = {
  popover: ["card"],
  muted: ["secondary"],
  input: ["border"],
  ring: ["primary"],
  "primary-2": ["primary", 0.5, "card"],
  terminal: ["card"],
  activity: ["card"],
  files: ["card"],
  editor: ["card"],
  "code-text": ["foreground"],
  "syn-keyword": ["primary"],
  "syn-comment": ["muted-foreground"],
  "syn-operator": ["muted-foreground"],
  "line-number": ["muted-foreground", 0.55, "editor"],
  "current-line": ["primary", 0.05, "editor"],
  "code-selection": ["primary", 0.3, "editor"],
  "term-text": ["foreground"],
  "term-cursor": ["primary"],
  "ansi-magenta": ["primary"],
};
export const parentOf = (id: ColorId): ColorId | undefined => FOLLOWS[id]?.[0];

const o = (l: number, c: number, h: number): Oklch => ({ l, c, h });

/** The hand-tuned values of app.css. The built-in theme (no colors) reproduces them (test). */
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

const fromHexes = (m: Record<string, string>): Colors => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fromHex(v)!]));

/** ANSI colors of termtheme.ts (tuned for the built-in theme); magenta follows the accent. */
const ANSI_DEFAULTS = {
  dark: fromHexes({ "ansi-red": "#eb8182", "ansi-green": "#6fc884", "ansi-yellow": "#e8be62", "ansi-blue": "#6fa7ee", "ansi-cyan": "#5fc9db" }),
  light: fromHexes({ "ansi-red": "#c12535", "ansi-green": "#137738", "ansi-yellow": "#8d5e00", "ansi-blue": "#2460b7", "ansi-cyan": "#0e7381" }),
};
const BASE: { light: Colors; dark: Colors } = { light: { ...DEFAULTS.light, ...ANSI_DEFAULTS.light }, dark: { ...DEFAULTS.dark, ...ANSI_DEFAULTS.dark } };

/** Code color schemes, independent of the app theme; "theme" uses the theme's own code colors. */
export const CODE_SCHEMES = ["theme", "clear", "pastel", "warm"] as const;
export type CodeScheme = (typeof CODE_SCHEMES)[number];
const SCHEMES: Record<Exclude<CodeScheme, "theme">, { light: Colors; dark: Colors }> = {
  clear: {
    dark: fromHexes({ "code-text": "#f2f3f7", "syn-comment": "#8b8fa0", "syn-keyword": "#ff7ab6", "syn-string": "#9be37a", "syn-number": "#ffb15e", "syn-type": "#5fd4ff", "syn-fn": "#ffe066", "syn-prop": "#b3a3ff", "syn-const": "#ff8f6b", "syn-regexp": "#4fe0c4", "syn-meta": "#f59ad8", "syn-operator": "#c3c6d4" }),
    light: fromHexes({ "code-text": "#14161c", "syn-comment": "#6b6f80", "syn-keyword": "#c2185b", "syn-string": "#2e7d32", "syn-number": "#b45309", "syn-type": "#0369a1", "syn-fn": "#8a6d00", "syn-prop": "#5b3cc4", "syn-const": "#c2410c", "syn-regexp": "#0f766e", "syn-meta": "#a21caf", "syn-operator": "#4b4f5e" }),
  },
  pastel: {
    dark: fromHexes({ "code-text": "#dcdfe8", "syn-comment": "#7a7f91", "syn-keyword": "#d7a6e8", "syn-string": "#b8dcb0", "syn-number": "#f0c8a0", "syn-type": "#a8d0e6", "syn-fn": "#e8dca8", "syn-prop": "#b4c0ec", "syn-const": "#f0b4b0", "syn-regexp": "#a8e0d8", "syn-meta": "#e6b8d8", "syn-operator": "#a3a7b6" }),
    light: fromHexes({ "code-text": "#3a3d48", "syn-comment": "#8a8e9c", "syn-keyword": "#8e5aa8", "syn-string": "#4f8a46", "syn-number": "#a8683a", "syn-type": "#3f7aa0", "syn-fn": "#86752a", "syn-prop": "#5664a8", "syn-const": "#a85450", "syn-regexp": "#3a8a80", "syn-meta": "#9a4f86", "syn-operator": "#6c7080" }),
  },
  warm: {
    dark: fromHexes({ "code-text": "#f1e6d8", "syn-comment": "#8c8073", "syn-keyword": "#ff9e64", "syn-string": "#e0c46c", "syn-number": "#ff7a7a", "syn-type": "#f6b26b", "syn-fn": "#ffd479", "syn-prop": "#e8a87c", "syn-const": "#ff8a65", "syn-regexp": "#d4b483", "syn-meta": "#e89a9a", "syn-operator": "#b8ab9c" }),
    light: fromHexes({ "code-text": "#2d241c", "syn-comment": "#8a7a6a", "syn-keyword": "#b4441a", "syn-string": "#8a6a00", "syn-number": "#b42318", "syn-type": "#a0541a", "syn-fn": "#8a5a00", "syn-prop": "#94502e", "syn-const": "#c2410c", "syn-regexp": "#7a5c2e", "syn-meta": "#a33b3b", "syn-operator": "#6e6255" }),
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
  version: 2;
  id: string;
  name: string;
  /** The theme's own colors per mode; everything else follows its parent or keeps the built-in value. */
  colors: { light: Colors; dark: Colors };
  /** Code colors from a scheme (own colors still win). */
  code: CodeScheme;
  /** Glow on cards and dialogs, % of the glow color. */
  glow: number;
  glowAt: (typeof GLOW_AT)[number];
  glowRef: Ref;
  /** Gradient behind the app (visible between panels and in the project list). */
  backdrop: { on: boolean; strength: number; gradient: Gradient };
  /** Film grain over the backdrop against banding, 0..100. */
  grain: number;
};

export const MAX_STOPS = 8;
const ATELIER_ID = "atelier";

// --- seeds: the generator of the version 1 themes, still used for presets and to migrate old themes ---

/** Version 1 seeds: tint, accent, surface depth and contrast; its lightness was fitted for contrast (WCAG). */
type Seeds = { base: { h: number; c: number }; accent: { h: number; c: number }; accent2: { h: number; c: number } | null; surface: number; contrast: number };
const SEEDS: Seeds = { base: { h: 265, c: 0.012 }, accent: { h: 292, c: 0.14 }, accent2: null, surface: 0, contrast: 50 };

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

function fromSeeds(s: Seeds, dark: boolean): Colors {
  const D = dark ? DEFAULTS.dark : DEFAULTS.light;
  const out = { ...D };
  const k = (s.contrast - 50) / 50; // -1..1
  const bgL = clampL(D.background.l + (s.surface / 100) * (dark ? 0.07 : 0.04));
  const tint = SEEDS.base.c ? s.base.c / SEEDS.base.c : 0;
  for (const name of NEUTRAL) out[name] = { l: D[name].l, c: Math.min(0.08, D[name].c * tint), h: s.base.h };
  const cScale = s.accent.c / SEEDS.accent.c;
  for (const name of ACCENTED) out[name] = { l: D[name].l, c: Math.min(0.37, D[name].c * cScale), h: (D[name].h - SEEDS.accent.h + s.accent.h + 360) % 360 };
  const rel = (name: Token, f: number) => (out[name] = { ...out[name], l: clampL(bgL + (D[name].l - D.background.l) * f) });
  out.background = { ...out.background, l: bgL };
  for (const name of SURFACES) rel(name, 1 + 0.5 * k);
  for (const name of ["border", "input"] as Token[]) rel(name, 1 + 0.8 * k);
  for (const name of ["foreground", "muted-foreground"] as Token[]) rel(name, 1 + 0.25 * k);
  const surfaces = [out.background, out.card, out.secondary];
  out.foreground = fit(out.foreground, surfaces, 7);
  out["muted-foreground"] = fit(out["muted-foreground"], surfaces, 4.5);
  out.primary = fit(out.primary, [out.background, out.card], 3);
  out.ring = { ...out.ring, l: out.primary.l };
  out["primary-foreground"] = fit(out["primary-foreground"], [out.primary], 4.5);
  for (const [name, ratio] of FIXED) out[name] = fit(D[name], [out.background, out.card], ratio);
  // Only what differs from the built-in values, so the rest keeps following.
  const diff: Colors = {};
  for (const name of TOKENS) if (["l", "c", "h"].some((ch) => Math.abs(out[name][ch as "l"] - D[name][ch as "l"]) > 1e-9)) diff[name] = out[name];
  if (s.accent2) {
    const c = Math.min(0.37, (D.primary.c * s.accent2.c) / SEEDS.accent.c);
    diff["primary-2"] = fit({ l: out.primary.l, c, h: s.accent2.h }, [out.background, out.card], 3);
  }
  return diff;
}
const seeded = (s: Partial<Seeds>) => ({ light: fromSeeds({ ...SEEDS, ...s }, false), dark: fromSeeds({ ...SEEDS, ...s }, true) });

const preset = (over: Partial<Theme> & Pick<Theme, "id" | "name">): Theme => ({
  version: 2,
  colors: { light: {}, dark: {} },
  code: "theme",
  glow: 8,
  glowAt: "top right",
  glowRef: "primary",
  backdrop: { on: false, strength: 60, gradient: { kind: "radial", angle: 135, x: 100, y: 0, space: "oklab", stops: [{ color: { ref: "primary" }, alpha: 18, pos: 0 }, { color: { ref: "primary" }, alpha: 0, pos: 70 }] } },
  grain: 0,
  ...over,
});

/** A fresh theme: the built-in colors, nothing of its own yet. */
export const blankTheme = (id: string, name: string): Theme => preset({ id, name });

/** Built-in themes; "atelier" is app.css itself (no generated CSS). */
export const PRESETS: Theme[] = [
  preset({ id: ATELIER_ID, name: "Atelier" }),
  preset({
    id: "oled",
    name: "OLED",
    glow: 0,
    // Dark: true black for OLED screens, panels only set apart by their edge. Light: the built-in colors.
    colors: {
      light: {},
      dark: fromHexes({
        background: "#000000",
        chrome: "#000000",
        card: "#050505",
        popover: "#0e0e10",
        secondary: "#141416",
        accent: "#1d1b27",
        border: "#1f1f23",
        input: "#28282e",
        foreground: "#ededf0",
        "muted-foreground": "#8e8e98",
        terminal: "#000000",
        editor: "#000000",
        "current-line": "#0d0d10",
      }),
    },
  }),
  preset({
    id: "midnight",
    name: t("Mitternacht"),
    colors: seeded({ base: { h: 255, c: 0.02 }, accent: { h: 245, c: 0.15 }, accent2: { h: 200, c: 0.12 }, surface: -40 }),
    glow: 12,
    backdrop: {
      on: true,
      strength: 70,
      gradient: { kind: "radial", angle: 0, x: 15, y: 0, space: "oklch", stops: [{ color: { ref: "primary" }, alpha: 22, pos: 0 }, { color: { ref: "primary-2" }, alpha: 8, pos: 40 }, { color: { ref: "background" }, alpha: 0, pos: 80 }] },
    },
  }),
  preset({
    id: "forest",
    name: t("Wald"),
    colors: seeded({ base: { h: 160, c: 0.014 }, accent: { h: 152, c: 0.13 }, accent2: { h: 110, c: 0.12 } }),
    glow: 10,
    glowAt: "top left",
    backdrop: {
      on: true,
      strength: 55,
      gradient: { kind: "linear", angle: 160, x: 50, y: 50, space: "oklch", stops: [{ color: { ref: "primary" }, alpha: 16, pos: 0 }, { color: { ref: "background" }, alpha: 0, pos: 55 }] },
    },
    grain: 30,
  }),
  preset({
    id: "ember",
    name: t("Glut"),
    colors: seeded({ base: { h: 40, c: 0.012 }, accent: { h: 35, c: 0.16 }, accent2: { h: 75, c: 0.15 } }),
    glow: 14,
    backdrop: {
      on: true,
      strength: 65,
      gradient: { kind: "conic", angle: 200, x: 100, y: 0, space: "longer", stops: [{ color: { ref: "primary" }, alpha: 16, pos: 0 }, { color: { ref: "primary-2" }, alpha: 10, pos: 50 }, { color: { ref: "primary" }, alpha: 16, pos: 100 }] },
    },
    grain: 40,
  }),
  preset({ id: "graphite", name: t("Graphit"), colors: seeded({ base: { h: 265, c: 0 }, accent: { h: 250, c: 0.06 }, contrast: 75 }), glow: 0 }),
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

function colors(v: unknown): Colors {
  const out: Colors = {};
  if (!isObj(v)) return out;
  for (const k of IDS) {
    const c = color(v[k]);
    if (c) out[k] = c;
  }
  return out;
}

/** Theme from untrusted JSON: unknown keys dropped, numbers clamped, enums checked; version 1 is converted with
 *  its look kept. undefined if not a theme. */
export function parseTheme(v: unknown): Theme | undefined {
  if (!isObj(v) || (v.version !== 1 && v.version !== 2)) return undefined;
  const d = PRESETS[0];
  const bd = isObj(v.backdrop) ? v.backdrop : {};
  let cols: Theme["colors"];
  if (v.version === 1) {
    const s: Seeds = {
      base: hc(v.base, SEEDS.base),
      accent: hc(v.accent, SEEDS.accent),
      accent2: v.accent2 === null || v.accent2 === undefined ? null : hc(v.accent2, SEEDS.accent),
      surface: num(v.surface, -100, 100, 0),
      contrast: num(v.contrast, 0, 100, 50),
    };
    const ov = isObj(v.overrides) ? v.overrides : {};
    cols = { light: { ...fromSeeds(s, false), ...colors(ov.light) }, dark: { ...fromSeeds(s, true), ...colors(ov.dark) } };
  } else {
    const c = isObj(v.colors) ? v.colors : {};
    cols = { light: colors(c.light), dark: colors(c.dark) };
  }
  return {
    version: 2,
    id: typeof v.id === "string" && /^[\w-]{1,64}$/.test(v.id) ? v.id : newId(),
    name: typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 40) : t("Eigenes Theme"),
    colors: cols,
    code: pick(v.code, CODE_SCHEMES, "theme"),
    glow: num(v.glow, 0, 30, d.glow),
    glowAt: pick(v.glowAt, GLOW_AT, d.glowAt),
    glowRef: pick(v.glowRef, REFS, d.glowRef),
    backdrop: { on: bd.on === true, strength: num(bd.strength, 0, 100, d.backdrop.strength), gradient: gradient(bd.gradient, d.backdrop.gradient) },
    grain: num(v.grain, 0, 100, 0),
  };
}

export const newId = () => "t" + Math.random().toString(36).slice(2, 10);

// --- resolution ---

const mode = (dark: boolean) => (dark ? "dark" : "light");
const schemeColor = (th: Theme, dark: boolean, id: ColorId) => (th.code === "theme" ? undefined : SCHEMES[th.code][mode(dark)][id]);
/** The color the theme itself sets (own, else from its code scheme). */
const setColor = (th: Theme, dark: boolean, id: ColorId) => th.colors[mode(dark)][id] ?? schemeColor(th, dark, id);
const chainSet = (th: Theme, dark: boolean, id: ColorId): boolean => !!setColor(th, dark, id) || (!!FOLLOWS[id] && chainSet(th, dark, FOLLOWS[id]![0]));

/** Where a color comes from: own, the code scheme, its parent, or the built-in value. */
export function origin(th: Theme, dark: boolean, id: ColorId): "own" | "scheme" | "follows" | "default" {
  if (th.colors[mode(dark)][id]) return "own";
  if (schemeColor(th, dark, id)) return "scheme";
  const f = FOLLOWS[id];
  return f && (!BASE[mode(dark)][id] || chainSet(th, dark, f[0])) ? "follows" : "default";
}

/** Every color of one mode as the app shows it. A color with a built-in value keeps it until its parent changes. */
export function derive(th: Theme, dark: boolean): Palette {
  const out: Partial<Palette> = {};
  const base = BASE[mode(dark)];
  const get = (id: ColorId): Oklch => {
    const hit = out[id];
    if (hit) return hit;
    const own = setColor(th, dark, id);
    const f = FOLLOWS[id];
    let v: Oklch;
    if (own) v = own;
    else if (base[id] && !(f && chainSet(th, dark, f[0]))) v = base[id]!;
    else v = f![1] === undefined ? get(f![0]) : over(get(f![0]), f![1], get(f![2]!));
    return (out[id] = v);
  };
  for (const id of IDS) get(id);
  return out as Palette;
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

/** Stylesheet for a theme ("" for the built-in one: app.css as is). Higher specificity than app.css's :root/.dark.
 *  Variables that app.css derives (terminal, code colors) are written only when the theme sets them, so the rest
 *  keeps following through var(). */
export function themeCss(th: Theme, interp = true): string {
  if (th.id === ATELIER_ID) return "";
  const block = (dark: boolean) => {
    const v = derive(th, dark);
    const extra = EXTRA.filter((id) => setColor(th, dark, id));
    return [...TOKENS, ...extra].map((name) => `--${name}:${css(v[name])};`).join("");
  };
  const root = [`--glow:${+th.glow.toFixed(1)}%`, `--glow-at:${th.glowAt}`, `--glow-color:var(--${th.glowRef})`, `--grain:${+(th.grain / 100).toFixed(3)}`];
  if (th.backdrop.on) root.push(`--backdrop:${gradientCss(th.backdrop.gradient, interp)}`, `--backdrop-opacity:${+(th.backdrop.strength / 100).toFixed(3)}`);
  return `:root:not(.dark){${block(false)}}:root.dark{${block(true)}}:root{${root.join(";")}}`;
}

/** Color a theme reference stands for in one mode. */
export const refColor = (v: Palette, r: Ref): Oklch => v[r];

// --- terminal ---

type Ansi = Record<string, string>;

/** xterm ITheme for a theme, or undefined for the built-in one (termtheme.ts keeps its tuned palette). */
export function terminalColors(th: Theme, dark: boolean): Ansi | undefined {
  if (th.id === ATELIER_ID) return undefined;
  const v = derive(th, dark);
  const bg = v.terminal;
  const fg = v["term-text"];
  const out: Ansi = {
    // Alpha 0: see termtheme.ts (WebGL paints attributed cells opaque in this color).
    background: hex(bg, 0),
    foreground: hex(fg),
    cursor: hex(v["term-cursor"]),
    cursorAccent: hex(bg),
    selectionBackground: hex(v["term-cursor"], 0.25),
    black: hex(dark ? v.secondary : fg),
    white: hex({ l: dark ? 0.82 : 0.5, c: fg.c, h: fg.h }),
    brightBlack: hex(v["muted-foreground"]),
    brightWhite: hex(dark ? fg : v["muted-foreground"]),
  };
  for (const name of ["red", "green", "yellow", "blue", "magenta", "cyan"]) {
    const col = v[`ansi-${name}` as ColorId];
    out[name] = hex(col);
    // Bright: further from the background (lighter in dark mode, darker in light mode, see termtheme.ts).
    out["bright" + name[0].toUpperCase() + name.slice(1)] = hex({ ...col, l: clampL(col.l + (dark ? 0.08 : -0.06)), c: col.c * 0.85 });
  }
  return out;
}
