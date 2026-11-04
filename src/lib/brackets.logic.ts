// Bracket pair colorization: pairing of bracket tokens, independent of CodeMirror.

export type Bracket = { ch: string; from: number };

const OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Pairs brackets given in document order on top of `stack` (opens still unclosed before them; mutated, so afterwards
 * it holds what is still open). Returns per bracket its nesting depth, or -1 for a closing bracket without its open.
 * A mismatched close does not pop, as in VS Code: `( ]` leaves the `(` open.
 */
export function pairBrackets(list: Bracket[], stack: Bracket[]): number[] {
  return list.map((b) => {
    const open = OPEN[b.ch];
    if (!open) return stack.push(b) - 1;
    if (stack.at(-1)?.ch !== open) return -1;
    stack.pop();
    return stack.length;
  });
}
