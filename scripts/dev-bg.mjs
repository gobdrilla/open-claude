#!/usr/bin/env node
// `npm run tauri dev` without taking window focus (also on every restart after a Rust change), for scripts/ui.mjs.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plat = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
// Unthrottled: a covered WKWebView stops requestAnimationFrame, so transitions and exit animations would hang.
// The platform file replaces the base windows array, --config replaces it again: pass the full windows.
const windows = (read(`src-tauri/tauri.${plat}.conf.json`).app?.windows ?? read("src-tauri/tauri.conf.json").app.windows).map((w) => ({ ...w, focus: false, backgroundThrottling: "disabled" }));
// As a file: on Windows the shell (needed for npx.cmd) would split inline JSON at spaces and quotes.
const cfg = join(tmpdir(), "ocui-dev-bg.json");
writeFileSync(cfg, JSON.stringify({ app: { windows } }));
const win = process.platform === "win32";
const child = spawn("npx", ["tauri", "dev", "--config", win ? `"${cfg}"` : cfg, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, OCUI_BACKGROUND: "1" },
  shell: win,
});
child.on("exit", (code) => process.exit(code ?? 1));
