// Postfix completion (Rider/IntelliJ): after "expr." the list also offers if, not, var/const, return, foreach/for,
// null checks and a log line; choosing one replaces "expr.key" with the template around the expression. Added next to
// the language server's completions (languageData), not instead of them.
import { EditorState, type Extension } from "@codemirror/state";
import { snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { fill, postfixAt, postfixLang, postfixes } from "$lib/postfix.logic";

export function postfix(path: string): Extension {
  const lang = postfixLang(path);
  if (!lang) return [];
  const list = postfixes(lang);
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const at = postfixAt(line.text.slice(0, ctx.pos - line.from));
    if (!at) return null;
    // Not in strings and comments: "e.g." there is prose, not an expression.
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (/String|Comment/.test(node.type.name)) return null;
    const exprFrom = ctx.pos - at.key.length - 1 - at.expr.length;
    // Typed two letters of a template: it goes first (above the server's "foreach" keyword); otherwise last, so the
    // members of expr stay on top. Asked again per letter (no validFor) to move them.
    const typed = at.key.length >= 2;
    const options = list.map(
      (p): Completion => ({
        label: p.key,
        detail: p.detail,
        type: "keyword",
        boost: typed && p.key.startsWith(at.key) ? 99 : -99,
        apply: (view, completion, _from, to) => snippet(fill(p.template, at.expr))(view, completion, exprFrom, to),
      }),
    );
    return { from: ctx.pos - at.key.length, options };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
