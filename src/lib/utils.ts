import { t } from "./i18n.ts";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Type scale tokens from app.css; unknown, twMerge would treat text-meta as a color and drop text-muted-foreground.
// Also passed to tv() definitions that use a token (tv merges with its own instance).
export const twMergeConfig = { extend: { theme: { text: ["meta", "ui", "body", "title"] } } };
const twMerge = extendTailwindMerge(twMergeConfig);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

/**
 * Action: tooltip only while the text is cut off (checked on hover). A tooltip that repeats visible text only
 * covers what is next to it, e.g. the first entry of a context menu.
 */
export function clipTitle(node: HTMLElement, text: string) {
  const set = () => (node.title = node.scrollWidth > node.clientWidth ? text : "");
  node.addEventListener("pointerenter", set);
  return {
    update: (next: string) => void (text = next),
    destroy: () => node.removeEventListener("pointerenter", set),
  };
}

const AGE_STEPS: [number, string][] = [
  [31536e6, "{n} J"],
  [2592e6, "{n} Mo"],
  [864e5, "{n} T"],
  [36e5, "{n} h"],
  [6e4, "{n} min"],
];

/** Kurzes Alter eines ISO-Zeitpunkts: "3 T", "2 Mo"; leer ohne Datum. */
/** Alt+<k> als App-Kuerzel. "Dead" ist die Tottaste (US-Mac Option+E); druckbare Zeichen wie € (de-Mac Option+E)
 *  bleiben Eingabe, sonst liesse sich € nirgends mehr tippen. AltGr setzt ctrlKey und faellt raus. */
export function altKey(e: KeyboardEvent, k: "e" | "g"): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === k || (e.key === "Dead" && e.code === `Key${k.toUpperCase()}`));
}

export function age(iso: string) {
  if (!iso) return "";
  const diff = Date.now() - Date.parse(iso);
  for (const [ms, unit] of AGE_STEPS) if (diff >= ms) return t(unit, { n: Math.floor(diff / ms) });
  return t("jetzt");
}
