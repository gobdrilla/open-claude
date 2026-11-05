// OKLCH math for the theme editor: sRGB gamut mapping, hex conversion and WCAG 2 contrast.
// Matrices from Björn Ottosson's OKLab definition.

export type Oklch = { l: number; c: number; h: number };

type Rgb = [number, number, number];

/** OKLCH to linear sRGB (may fall outside 0..1 when out of gamut). */
function linear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inside = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const ungamma = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Into the sRGB gamut by lowering chroma at constant L and h (CSS Color 4 style, without the JND shortcut). */
export function toGamut(col: Oklch): Oklch {
  const c0 = { l: clamp01(col.l), c: Math.max(0, col.c), h: col.h };
  if (inside(linear(c0))) return c0;
  let lo = 0;
  let hi = c0.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inside(linear({ ...c0, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...c0, c: lo };
}

/** Relative luminance (WCAG 2) of the color as displayed. */
export function luminance(col: Oklch): number {
  const [r, g, b] = linear(toGamut(col)).map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: Oklch, b: Oklch): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const encode = (v: number) => Math.round(255 * gamma(clamp01(v)));

/** "#rrggbb", or "#rrggbbaa" with alpha 0..1. */
export function hex(col: Oklch, alpha?: number): string {
  const parts = linear(toGamut(col)).map(encode);
  if (alpha !== undefined) parts.push(Math.round(clamp01(alpha) * 255));
  return "#" + parts.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** "#rgb" or "#rrggbb" to OKLCH; undefined if not a hex color. */
export function fromHex(s: string): Oklch | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return undefined;
  const d = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join("") : m[1];
  return fromLinear([0, 2, 4].map((i) => ungamma(parseInt(d.slice(i, i + 2), 16) / 255)) as Rgb);
}

/** `top` with opacity `alpha` (0..1) over `bottom`, blended in gamma-encoded sRGB like browsers composite. */
export function over(top: Oklch, alpha: number, bottom: Oklch): Oklch {
  const t = linear(toGamut(top)).map((v) => gamma(clamp01(v)));
  const b = linear(toGamut(bottom)).map((v) => gamma(clamp01(v)));
  const a = clamp01(alpha);
  return fromLinear(t.map((v, i) => ungamma(v * a + b[i] * (1 - a))) as Rgb);
}

function fromLinear([r, g, b]: Rgb): Oklch {
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: c < 1e-4 ? 0 : c, h };
}

/** CSS literal; alpha 0..1 optional. */
export function css({ l, c, h }: Oklch, alpha?: number): string {
  const a = alpha === undefined || alpha >= 1 ? "" : ` / ${Math.round(alpha * 1000) / 10}%`;
  return `oklch(${+l.toFixed(4)} ${+c.toFixed(4)} ${+h.toFixed(2)}${a})`;
}

/** Shifts fg's lightness (away from bg) just enough to reach `ratio` against every color in `bgs`.
 *  Unchanged if it already passes; the extreme (black/white) if nothing reaches it. */
export function fit(fg: Oklch, bgs: Oklch[], ratio: number): Oklch {
  const ok = (l: number) => bgs.every((bg) => contrast({ ...fg, l }, bg) >= ratio);
  if (ok(fg.l)) return fg;
  // Direction: lighter text on dark backgrounds, darker on light ones (judged by the brightest background).
  const up = Math.max(...bgs.map(luminance)) < 0.18;
  const end = up ? 1 : 0;
  if (!ok(end)) return { ...fg, l: end };
  let near = fg.l;
  let far = end;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (ok(mid)) far = mid;
    else near = mid;
  }
  return { ...fg, l: far };
}
