#!/usr/bin/env node
// `npm run tauri dev` without taking window focus (also on every restart after a Rust change), for scripts/ui.mjs.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const plat = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
// Unthrottled: a covered WKWebView stops requestAnimationFrame, so transitions and exit animations would hang.
// The platform file replaces the base windows array, --config replaces it again: pass the full windows.
const windows = (read(`src-tauri/tauri.${plat}.conf.json`).app?.windows ?? read("src-tauri/tauri.conf.json").app.windows).map((w) => ({ ...w, focus: false, backgroundThrottling: "disabled" }));
const child = spawn("npx", ["tauri", "dev", "--config", JSON.stringify({ app: { windows } }), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, OCUI_BACKGROUND: "1" },
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 1));
