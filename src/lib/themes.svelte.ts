// Active theme and the user's own themes. localStorage, like the light/dark choice: app.html needs the generated
// CSS before the first paint ("themeCss"). Everything read back goes through parseTheme again.
import { PRESETS, isPreset, newId, parseTheme, terminalColors, themeCss, type Theme } from "./themes";
import { t } from "./i18n";

const OWN = "themes";
const ACTIVE = "themeId";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* only for this session */
  }
}

function ownThemes(): Theme[] {
  try {
    const v: unknown = JSON.parse(read(OWN) ?? "[]");
    return Array.isArray(v) ? v.map(parseTheme).filter((x) => x !== undefined) : [];
  } catch {
    return [];
  }
}
export const themes = $state({ own: ownThemes(), active: read(ACTIVE) ?? "atelier" });

export const current = (): Theme => themes.own.find((x) => x.id === themes.active) ?? PRESETS.find((p) => p.id === themes.active) ?? PRESETS[0];

/** xterm colors of the active theme; updated with a delay so dragging a slider does not re-raster terminals per frame. */
const palette = () => {
  const th = $state.snapshot(current()) as Theme;
  return { light: terminalColors(th, false), dark: terminalColors(th, true) };
};
export const terminal = $state({ v: palette() });

const interp = typeof CSS !== "undefined" && CSS.supports("background-image", "linear-gradient(in oklch, red, blue)");
let frame = 0;
let later: ReturnType<typeof setTimeout> | undefined;

function apply() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const th = $state.snapshot(current()) as Theme;
    const text = themeCss(th, interp);
    let el = document.getElementById("user-theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "user-theme";
      document.head.appendChild(el);
    }
    el.textContent = text;
    write("themeCss", text);
  });
  clearTimeout(later);
  later = setTimeout(() => {
    terminal.v = palette();
    write(OWN, JSON.stringify(themes.own));
    write(ACTIVE, themes.active);
  }, 150);
}

export function selectTheme(id: string) {
  themes.active = id;
  apply();
}

/** Changes the active theme; a built-in one is copied first (presets stay as shipped). */
export function editTheme(fn: (th: Theme) => void) {
  if (isPreset(themes.active)) copyTheme();
  const th = themes.own.find((x) => x.id === themes.active);
  if (!th) return;
  fn(th);
  apply();
}

export function copyTheme() {
  const src = $state.snapshot(current()) as Theme;
  themes.own.push({ ...structuredClone(src), id: newId(), name: t("{name} (Kopie)", { name: src.name }).slice(0, 40) });
  selectTheme(themes.own[themes.own.length - 1].id);
}

export function deleteTheme(id: string) {
  themes.own = themes.own.filter((x) => x.id !== id);
  if (themes.active === id) themes.active = "atelier";
  apply();
}

/** Theme from pasted JSON; undefined if it is not one. Always gets a fresh id. */
export function importTheme(text: string): Theme | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const th = parseTheme(raw);
  if (!th) return undefined;
  th.id = newId();
  themes.own.push(th);
  selectTheme(th.id);
  return th;
}

export function exportTheme(): string {
  const { id: _, ...rest } = $state.snapshot(current()) as Theme;
  return JSON.stringify(rest, null, 2);
}

// Regenerate on start: the cached CSS may come from an older app version.
apply();
