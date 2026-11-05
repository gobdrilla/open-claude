import { t } from "$lib/i18n";
import type { GLOW_AT, Ref } from "$lib/themes";

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
