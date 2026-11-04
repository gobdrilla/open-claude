// Runtime state of app extensions: built-ins bundled from src/extensions, user ones from <app_data_dir>/extensions (ext_scan).
// Global values live in the store (settings.json, key "extensions"), per-project values in the local git config ocui.ext.<id>.<key>.
import { invoke } from "@tauri-apps/api/core";
import type { Store } from "@tauri-apps/plugin-store";
import { compileLinker, parseManifest, resolve, type Linker, type Manifest, type Values } from "./extensions.logic.ts";

export type Entry = { key: string; source: "builtin" | "user"; dir?: string; manifest?: Manifest; error?: string; warnings: string[] };
type RepoValues = Record<string, Record<string, string>>;

const BUILTIN = import.meta.glob("/src/extensions/*/manifest.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

export const exts = $state({
  list: [] as Entry[],
  enabled: {} as Record<string, boolean>,
  settings: {} as Record<string, Values>,
  /** Per-project values by repo path, loaded with loadRepo. */
  repo: {} as Record<string, RepoValues>,
  scanning: false,
});

let store: Store | null = null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function initExtensions(s: Store) {
  store = s;
  // A broken store value is ignored: defaults apply.
  const v = await s.get<unknown>("extensions").catch(() => null);
  if (isObj(v)) {
    if (isObj(v.enabled)) exts.enabled = Object.fromEntries(Object.entries(v.enabled).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean>;
    if (isObj(v.settings))
      exts.settings = Object.fromEntries(
        Object.entries(v.settings)
          .filter(([, o]) => isObj(o))
          .map(([id, o]) => [id, Object.fromEntries(Object.entries(o as object).filter(([, x]) => typeof x === "string" || typeof x === "boolean"))]),
      );
  }
  await rescan();
}

/** Built-ins first: on the same id the built-in wins, the user one shows "ID schon vergeben". */
export async function rescan() {
  exts.scanning = true;
  const list: Entry[] = Object.entries(BUILTIN).map(([path, text]) => entry(path, "builtin", text));
  // Scan failure: only the built-ins, no error toast (nothing is lost).
  const files = await invoke<{ dir: string; text: string | null; error: string | null }[]>("ext_scan").catch(() => []);
  for (const f of files) {
    const e = f.error ? { key: f.dir, source: "user" as const, dir: f.dir, error: f.error, warnings: [] } : entry(f.dir, "user", f.text ?? "", f.dir);
    if (e.manifest && list.some((x) => x.manifest?.id === e.manifest!.id)) e.error = "ID schon vergeben";
    list.push(e);
  }
  exts.list = list;
  exts.scanning = false;
}

function entry(key: string, source: Entry["source"], text: string, dir?: string): Entry {
  const r = parseManifest(text);
  return "error" in r ? { key, source, dir, error: r.error, warnings: [] } : { key, source, dir, manifest: r.manifest, warnings: r.warnings };
}

/** Built-ins default to on (Jira stays inert without a URL), user extensions to off until switched on deliberately. */
export const isOn = (e: Entry) => !!e.manifest && !e.error && (exts.enabled[e.manifest.id] ?? e.source === "builtin");
export const active = () => exts.list.filter(isOn).map((e) => e.manifest!);

const save = () => store?.set("extensions", $state.snapshot({ enabled: exts.enabled, settings: exts.settings }));

export function setEnabled(id: string, on: boolean) {
  exts.enabled[id] = on;
  save();
}

/** Empty string removes the global value, so the manifest default applies again. */
export function setGlobal(id: string, key: string, v: string | boolean) {
  const cur = { ...exts.settings[id] };
  if (v === "") delete cur[key];
  else cur[key] = v;
  exts.settings[id] = cur;
  save();
}

/** Reads ocui.ext.* of this repo; on failure only global values apply. */
export async function loadRepo(repo: string) {
  const rows = await invoke<[string, string, string][]>("git_ext_get", { repo }).catch(() => []);
  const vals: RepoValues = {};
  for (const [id, key, value] of rows) (vals[id] ??= {})[key] = value;
  exts.repo[repo] = vals;
}

/** null or "" removes the project value. */
export async function setRepo(repo: string, id: string, key: string, v: string | null) {
  await invoke("git_ext_set", { repo, id, key, value: v || null });
  await loadRepo(repo);
}

/** Link matchers of the enabled extensions for this repo; call inside $derived so it recompiles only when settings change. */
export function linkers(repo: string): Linker[] {
  const out: Linker[] = [];
  for (const m of active()) {
    const v = resolve(m.contributes.settings, exts.settings[m.id] ?? {}, exts.repo[repo]?.[m.id] ?? {});
    for (const p of m.contributes.linkProviders) {
      const l = compileLinker(p, v);
      if (l && typeof l !== "string") out.push(l);
    }
  }
  return out;
}
