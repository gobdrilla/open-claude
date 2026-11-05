// Editor tools for Claude: the MCP tools "lsp", "debugger" and "run" (src-tauri/src/ide.rs) arrive here as "ide-ask"
// and use the same language servers, debugger and run targets as the editor. The answer goes back via ide_answer.
// Claude Code asks the user before each call of these tools unless they allowed them.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "./i18n.ts";
import { rel } from "./editor.logic.ts";
import { lspTool, type LspArgs } from "./lsp.svelte.ts";
import { debug, debugEval, debugStart, debugStep, debugStop, debugVars, pushBreakpoints, type Var } from "./debug.svelte.ts";
import { allConfigs, chosen, detect, run, runRestart, runStart, runStop, tailOutput } from "./run.svelte.ts";

type Args = Record<string, unknown>;
type Ask = { id: number; repo: string; tool: string; args: Args | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

async function config(repo: string, label: string | undefined) {
  await detect(repo);
  const c = label ? allConfigs(repo).find((x) => x.label === label) : chosen(repo);
  if (!c) throw new Error(label ? t("Kein Startziel „{label}“; run list zeigt alle.", { label }) : t("Kein Startziel gefunden."));
  return c;
}

// ---------- debugger ----------

const varLine = (v: Var, depth: number): string[] => [
  `${"  ".repeat(depth)}${v.name}${v.type ? `: ${v.type}` : ""}${v.value ? ` = ${v.value}` : ""}${v.ref > 0 ? ` [ref ${v.ref}]` : ""}`,
  ...(v.open && v.kids ? v.kids.flatMap((k) => varLine(k, depth + 1)) : []),
];

function state(repo: string): string {
  const s = debug(repo).session;
  if (!s) return t("Keine Debug-Sitzung.");
  const out = [`phase: ${s.phase}${s.reason ? ` (${s.reason})` : ""}`];
  if (s.phase === "pause") {
    out.push("stack:", ...s.frames.slice(0, 30).map((f) => `${f.id === s.frame ? "> " : "  "}${f.name}  ${f.path ?? "?"}:${f.line}`));
    out.push("variables:", ...s.vars.flatMap((v) => varLine(v, 1)));
  }
  out.push("output:", s.out.slice(-4000));
  return out.join("\n");
}

/** Until the debugger stops (stack and first scope loaded) or ends; ms at most, then it still runs. */
async function settle(repo: string, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const s = debug(repo).session;
    if (!s || s.phase === "end" || (s.phase === "pause" && s.frames.length && s.vars[0]?.kids !== null)) return;
  }
}

const STEPS = { continue: "continue", next: "next", step_in: "stepIn", step_out: "stepOut" } as const;

async function debugTool(repo: string, a: Args): Promise<string> {
  const action = str(a.action) ?? "";
  if (action === "breakpoints") {
    const path = str(a.path);
    if (path) {
      const lines = Array.isArray(a.lines) ? [...new Set(a.lines.filter((n): n is number => Number.isInteger(n) && n > 0))].sort((x, y) => x - y) : [];
      pushBreakpoints(repo, rel(repo, path), lines);
    }
    const all = Object.entries(debug(repo).bps);
    return all.length ? all.map(([p, l]) => `${p}: ${l.join(", ")}`).join("\n") : t("Keine Breakpoints.");
  }
  if (action === "start") {
    await debugStart(repo, await config(repo, str(a.config)));
    // Waits for the first breakpoint; a program without one keeps running.
    await settle(repo, 20_000);
  } else if (action in STEPS) {
    await debugStep(repo, STEPS[action as keyof typeof STEPS]);
    await settle(repo, 10_000);
  } else if (action === "pause") {
    await debugStep(repo, "pause");
    await settle(repo, 5_000);
  } else if (action === "stop") await debugStop(repo);
  else if (action === "variables") {
    const ref = Number(a.ref);
    if (!(ref > 0)) throw new Error(t("ref fehlt."));
    return (await debugVars(repo, ref)).flatMap((v) => varLine(v, 0)).join("\n") || t("Keine Variablen.");
  } else if (action === "evaluate") return debugEval(repo, str(a.expression) ?? "");
  else if (action !== "state") throw new Error(t("Unbekannte action: {action}", { action }));
  return state(repo);
}

// ---------- run ----------

async function runTool(repo: string, a: Args): Promise<string> {
  const action = str(a.action) ?? "";
  const label = str(a.config);
  if (action === "list") {
    await detect(repo);
    const sel = chosen(repo)?.label;
    const list = allConfigs(repo).map((c) => `${c.label}${c.label === sel ? " *" : ""}${run(repo).of(c.label)?.state === "running" ? `  (${t("läuft")})` : ""}`);
    return list.join("\n") || t("Kein Startziel gefunden.");
  }
  if (action === "stop") {
    await runStop(repo, label);
    return t("Gestoppt.");
  }
  if (action === "output") return tailOutput(repo, 200, label) || t("Keine Ausgabe.");
  if (action !== "start" && action !== "restart") throw new Error(t("Unbekannte action: {action}", { action }));
  const c = await config(repo, label);
  if (action === "start") await runStart(repo, c);
  else await runRestart(repo, c.label);
  // First output (compile errors, server URL) instead of an empty answer.
  await sleep(3000);
  const r = run(repo).of(c.label);
  return `${c.label}: ${r?.state ?? "idle"}${r?.exit != null ? ` (exit ${r.exit})` : ""}\n${tailOutput(repo, 60, c.label)}`;
}

const TOOLS: Record<string, (repo: string, a: Args) => Promise<string>> = {
  lsp: (repo, a) => lspTool(repo, { ...(a as LspArgs), path: str(a.path) && rel(repo, str(a.path)!) }),
  debugger: debugTool,
  run: runTool,
};

/** Once at start (+page.svelte). */
export function listenAgent(): Promise<() => void> {
  return listen<Ask>("ide-ask", async ({ payload: { id, repo, tool, args } }) => {
    let ok = true;
    let text: string;
    try {
      const fn = TOOLS[tool];
      if (!fn) throw new Error(t("Unbekanntes Tool: {tool}", { tool }));
      text = await fn(repo, args ?? {});
    } catch (e) {
      ok = false;
      text = e instanceof Error ? e.message : String(e);
    }
    invoke("ide_answer", { id, ok, text }).catch(() => {});
  });
}
