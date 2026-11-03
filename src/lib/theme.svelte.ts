// Hell/Dunkel/System. Wahl in localStorage, weil app.html sie vor dem ersten Paint braucht.
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";

export type Mode = "system" | "light" | "dark";

const mq = matchMedia("(prefers-color-scheme: dark)");
// Linux: tao macht aus setTheme(null) "prefer-dark = false" und WebKitGTK meldet dann
// hell, egal was das System will. Dort darum das Portal-Theme vom Fenster holen
// (theme() fragt bei fehlender Vorgabe org.freedesktop.appearance) und fest setzen.
const linux = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
let systemDark = mq.matches;

function read(): Mode {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export const theme = $state({ mode: read(), dark: false });

function apply() {
  if (!linux) systemDark = mq.matches;
  theme.dark = theme.mode === "dark" || (theme.mode === "system" && systemDark);
  document.documentElement.classList.toggle("dark", theme.dark);
}

// Solange wir selbst umschalten, meldet matchMedia Zwischenstaende (setTheme(null) = hell).
let syncing = 0;

async function syncWindow(m: Mode) {
  const win = getCurrentWindow();
  if (m !== "system") return win.setTheme(m);
  if (!linux) return win.setTheme(null);
  syncing++;
  try {
    await win.setTheme(null); // Vorgabe loeschen, damit theme() das Portal fragt
    const sys: Theme = await win.theme().then((t) => t ?? "light", () => "light");
    systemDark = sys === "dark";
    await win.setTheme(sys);
  } finally {
    syncing--;
  }
}

export function setMode(m: Mode) {
  theme.mode = m;
  try {
    localStorage.setItem("theme", m);
  } catch {
    /* gilt nur fuer diese Sitzung */
  }
  apply();
  syncWindow(m).then(apply, () => {}); // erzwungenes Fenster-Theme verfaelscht matchMedia bis hierher
}

// Linux: Wechselt das System, setzt tao prefer-dark aus dem Portal neu, und WebKit meldet das
// ueber matchMedia. tao schickt ThemeChanged dabei an eine Dummy-Fenster-ID, onThemeChanged
// kommt darum nie an. Eigene Zwischenstaende beim Umschalten (syncing) nicht uebernehmen.
mq.addEventListener("change", () => {
  if (linux && theme.mode === "system" && !syncing) systemDark = mq.matches;
  apply();
});
setMode(theme.mode); // auch beim Start: Fenster-Theme an die gespeicherte Wahl angleichen
