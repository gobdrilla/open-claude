// UI language. The German text stays in the code and is the key (gettext style): t("Speichern") gives "Save" in
// English; a missing entry falls back to German. Choice in localStorage "lang" ("system" | "de" | "en"); "system"
// follows the OS (navigator.languages: German for de-*, English otherwise). It applies from the next start, so t()
// needs no runes and works in .logic.ts files and module constants too; node --test (no navigator) stays German.
// The Rust side gets the language from +page.svelte (set_lang) for its messages.
import editor from "./i18n/en/editor.ts";
import git from "./i18n/en/git.ts";
import app from "./i18n/en/app.ts";
import panels from "./i18n/en/panels.ts";
import misc from "./i18n/en/misc.ts";
import logic from "./i18n/en/logic.ts";

export type LangPref = "system" | "de" | "en";
export type Lang = "de" | "en";

function readPref(): LangPref {
  try {
    const v = localStorage.getItem("lang");
    return v === "de" || v === "en" ? v : "system";
  } catch {
    return "system";
  }
}

/** Language of the OS; German only for German locales. */
export function systemLang(langs: readonly string[] | undefined): Lang {
  return langs?.[0]?.toLowerCase().startsWith("de") ? "de" : "en";
}

const browser = typeof navigator !== "undefined" && typeof localStorage !== "undefined";
/** Saved choice. */
export const langPref: LangPref = browser ? readPref() : "de";
/** Language of this run. */
export const LANG: Lang = !browser ? "de" : langPref === "system" ? systemLang(navigator.languages ?? [navigator.language]) : langPref;

if (typeof document !== "undefined") document.documentElement.lang = LANG;

/** Takes effect at the next start. */
export function setLangPref(p: LangPref): void {
  try {
    localStorage.setItem("lang", p);
  } catch {
    // Blocked storage: stays as it is.
  }
}

const EN: Record<string, string> = { ...logic, ...misc, ...panels, ...app, ...git, ...editor };

/** Fill {name} placeholders. */
function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** The German UI text in the current language; {name} placeholders come from vars. */
export function t(de: string, vars?: Record<string, string | number>): string {
  return fill(LANG === "en" ? (EN[de] ?? de) : de, vars);
}

/** Same, for tests: the English text of a key. */
export const en = (de: string, vars?: Record<string, string | number>) => fill(EN[de] ?? de, vars);

/** BCP 47 tag for toLocaleString & Co. */
export const LOCALE = LANG === "en" ? "en-US" : "de-DE";
