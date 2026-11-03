import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Type scale tokens from app.css; unknown, twMerge would treat text-meta as a color and drop text-muted-foreground.
// shortcut: tv() definitions merge with the default config, so a token there must not share base/variant with a text color; pass twMergeConfig to tv() if that is ever needed.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["meta", "ui", "body", "title"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

const AGE_STEPS: [number, string][] = [
  [31536e6, "J"],
  [2592e6, "Mo"],
  [864e5, "T"],
  [36e5, "h"],
  [6e4, "min"],
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
  for (const [ms, unit] of AGE_STEPS) if (diff >= ms) return `${Math.floor(diff / ms)} ${unit}`;
  return "jetzt";
}
