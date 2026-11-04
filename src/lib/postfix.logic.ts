// Postfix completion as in Rider/IntelliJ: "list.foreach" + Enter becomes a loop over list. Pure parts for node --test;
// the completion source is components/editor/postfix.ts.

export type PostfixLang = "ts" | "cs";
export type Postfix = { key: string; detail: string; template: string };

/** Language of the file, or null where no templates exist. */
export function postfixLang(path: string): PostfixLang | null {
  if (/\.(c|m)?[jt]sx?$|\.svelte$|\.vue$/i.test(path)) return "ts";
  if (/\.cs$/i.test(path)) return "cs";
  return null;
}

/** Templates: $0 is the expression, ${name} a field to fill in, ${} the place the cursor ends up. */
const BLOCK = " {\n\t${}\n}";
// C#: brace on its own line, as the .NET formatter does.
const CS_BLOCK = "\n{\n\t${}\n}";
const TEMPLATES: Record<PostfixLang, Postfix[]> = {
  ts: [
    { key: "if", detail: "if (x) { }", template: "if ($0)" + BLOCK },
    { key: "not", detail: "!x", template: "!$0${}" },
    { key: "null", detail: "if (x == null) { }", template: "if ($0 == null)" + BLOCK },
    { key: "notnull", detail: "if (x != null) { }", template: "if ($0 != null)" + BLOCK },
    { key: "const", detail: "const name = x;", template: "const ${name} = $0;${}" },
    { key: "let", detail: "let name = x;", template: "let ${name} = $0;${}" },
    { key: "return", detail: "return x;", template: "return $0;${}" },
    { key: "log", detail: "console.log(x);", template: "console.log($0);${}" },
    { key: "for", detail: "for (const item of x) { }", template: "for (const ${item} of $0)" + BLOCK },
    { key: "await", detail: "await x", template: "await $0${}" },
  ],
  cs: [
    { key: "if", detail: "if (x) { }", template: "if ($0)" + CS_BLOCK },
    { key: "not", detail: "!x", template: "!$0${}" },
    { key: "null", detail: "if (x is null) { }", template: "if ($0 is null)" + CS_BLOCK },
    { key: "notnull", detail: "if (x is not null) { }", template: "if ($0 is not null)" + CS_BLOCK },
    { key: "var", detail: "var name = x;", template: "var ${name} = $0;${}" },
    { key: "return", detail: "return x;", template: "return $0;${}" },
    { key: "foreach", detail: "foreach (var item in x) { }", template: "foreach (var ${item} in $0)" + CS_BLOCK },
    { key: "cw", detail: "Console.WriteLine(x);", template: "Console.WriteLine($0);${}" },
    { key: "await", detail: "await x", template: "await $0${}" },
  ],
};

export const postfixes = (lang: PostfixLang) => TEMPLATES[lang];

// A chain of names, calls without nested parentheses, indexers and member accesses, ending in ".key".
const EXPR = /((?:[A-Za-z_$][\w$]*|\([^()\n]*\)|\[[^\]\n]*\]|\.(?=[A-Za-z_$(\[]))+)\.([A-Za-z]*)$/;

/** Expression and typed key before the cursor ("  a.b(1).fo" -> expr "a.b(1)", key "fo"), or null. */
export function postfixAt(before: string): { expr: string; key: string } | null {
  const m = EXPR.exec(before);
  if (!m || !/^[A-Za-z_$]/.test(m[1]) || /^\d/.test(m[1])) return null;
  return { expr: m[1], key: m[2] };
}

/** Template with the expression in, as a CodeMirror snippet (its own "${" and "#{" escaped). */
export function fill(template: string, expr: string): string {
  return template.replaceAll("$0", expr.replace(/([#$])\{/g, "$1\\{"));
}
