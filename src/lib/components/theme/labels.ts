import { t } from "$lib/i18n";
import type { CodeScheme, ColorId, GLOW_AT, Ref } from "$lib/themes";

export const REF_LABELS: Record<Ref, string> = {
  primary: t("Akzent"),
  "primary-2": t("Zweiter Akzent"),
  background: t("Hintergrund"),
  card: t("Karte"),
  foreground: t("Text"),
  muted: t("Gedämpft"),
  success: t("Erfolg"),
  warning: t("Warnung"),
  info: "Info",
  destructive: t("Fehler"),
};

export const GLOW_LABELS: Record<(typeof GLOW_AT)[number], string> = {
  "top right": t("Oben rechts"),
  "top left": t("Oben links"),
  top: t("Oben"),
  "bottom right": t("Unten rechts"),
  "bottom left": t("Unten links"),
};

export const SCHEME_LABELS: Record<CodeScheme, string> = { theme: t("Wie Theme"), clear: t("Klar"), pastel: t("Pastell"), warm: t("Warm") };

/** The theme editor's color list. Colors not listed (muted, ring) follow their parent. */
export const COLOR_GROUPS: { id: string; label: string; hint?: string; colors: [ColorId, string][] }[] = [
  {
    id: "base",
    label: t("Grundfarben"),
    hint: t("Vieles folgt diesen Farben, bis du es einzeln änderst."),
    colors: [
      ["background", t("App-Hintergrund")],
      ["foreground", t("Text")],
      ["primary", t("Akzent")],
      ["primary-2", t("Zweiter Akzent")],
    ],
  },
  {
    id: "areas",
    label: t("Bereiche"),
    colors: [
      ["chrome", t("Titelleiste")],
      ["card", t("Panels")],
      ["terminal", "Terminal"],
      ["activity", t("Aktivitäten-Panel")],
      ["files", t("Dateibaum")],
      ["editor", "Editor"],
      ["popover", t("Menüs und Popups")],
    ],
  },
  {
    id: "text",
    label: t("Text, Ränder, Auswahl"),
    colors: [
      ["muted-foreground", t("Nebentext")],
      ["border", t("Ränder")],
      ["input", t("Eingabefelder")],
      ["accent", t("Auswahl und Hover")],
      ["secondary", t("Flächen von Schaltflächen")],
      ["primary-foreground", t("Text auf Akzent")],
    ],
  },
  {
    id: "code",
    label: t("Editor-Farbschema"),
    hint: t("Gilt nur für Code, unabhängig vom App-Theme."),
    colors: [
      ["code-text", t("Code-Text")],
      ["syn-comment", t("Kommentare")],
      ["syn-keyword", t("Schlüsselwörter")],
      ["syn-string", "Strings"],
      ["syn-number", t("Zahlen")],
      ["syn-type", t("Typen")],
      ["syn-fn", t("Funktionen")],
      ["syn-prop", t("Eigenschaften")],
      ["syn-const", t("Konstanten")],
      ["syn-regexp", "Regex"],
      ["syn-meta", t("Annotationen")],
      ["syn-operator", t("Operatoren")],
      ["line-number", t("Zeilennummern")],
      ["current-line", t("Aktuelle Zeile")],
      ["code-selection", t("Auswahl im Code")],
      ["bracket-1", t("Klammern, Ebene 1")],
      ["bracket-2", t("Klammern, Ebene 2")],
      ["bracket-3", t("Klammern, Ebene 3")],
    ],
  },
  {
    id: "term",
    label: "Terminal",
    colors: [
      ["term-text", t("Terminal-Text")],
      ["term-cursor", "Cursor"],
      ["ansi-red", t("Rot")],
      ["ansi-green", t("Grün")],
      ["ansi-yellow", t("Gelb")],
      ["ansi-blue", t("Blau")],
      ["ansi-magenta", "Magenta"],
      ["ansi-cyan", "Cyan"],
    ],
  },
  {
    id: "status",
    label: "Status",
    colors: [
      ["success", t("Erfolg")],
      ["warning", t("Warnung")],
      ["info", "Info"],
      ["destructive", t("Fehler")],
    ],
  },
];

export const COLOR_LABEL: Partial<Record<ColorId, string>> = Object.fromEntries(COLOR_GROUPS.flatMap((g) => g.colors));
