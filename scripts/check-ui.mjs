// Controls come only from $lib/atelier-ui: raw elements and old import paths outside the library are errors.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const lib = join(src, "lib", "atelier-ui");
const RAW = /<(button|input|select|textarea)\b/g;
const OLD = /\$lib\/components\/(ui|kit)\b|\$lib\/atelier-ui\/.+["']/g;

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== lib) yield* files(p);
    } else if (/\.(svelte|ts|js)$/.test(e.name)) yield p;
  }
}

const bad = [];
for (const f of files(src)) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    const hits = [...l.matchAll(RAW)].map((m) => `<${m[1]}>`).concat([...l.matchAll(OLD)].map(() => "import not via $lib/atelier-ui"));
    for (const h of hits) bad.push(`${relative(root, f)}:${i + 1}  ${h}`);
  });
}

if (bad.length) {
  console.error(`atelier-ui: ${bad.length} place(s) bypass the UI library (use a component from $lib/atelier-ui or add one there):`);
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log("atelier-ui: ok");
