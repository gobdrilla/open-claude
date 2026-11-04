// Ref names with "/" as collapsible folders (issue/1, issue/2 -> issue > 1, 2).
// Folders come before leaves on each level; otherwise the input order stays
// (refname for branches, newest first for tags), a folder ranks by its first ref.
export type RefRow<T> =
  | { dir: true; path: string; label: string; depth: number; count: number; open: boolean }
  | { dir: false; path: string; label: string; depth: number; ref: T };

type Node<T> = { dirs: Map<string, Node<T>>; leaves: { label: string; ref: T }[]; count: number };
const node = <T>(): Node<T> => ({ dirs: new Map(), leaves: [], count: 0 });

export function refRows<T>(refs: T[], name: (r: T) => string, isOpen: (dirPath: string) => boolean): RefRow<T>[] {
  const root = node<T>();
  for (const r of refs) {
    const parts = name(r).split("/");
    let n = root;
    for (const seg of parts.slice(0, -1)) {
      n = n.dirs.get(seg) ?? n.dirs.set(seg, node<T>()).get(seg)!;
      n.count++;
    }
    n.leaves.push({ label: parts[parts.length - 1], ref: r });
  }
  const out: RefRow<T>[] = [];
  const walk = (n: Node<T>, prefix: string, depth: number) => {
    for (const [label, d] of n.dirs) {
      const path = prefix + label;
      const open = isOpen(path);
      out.push({ dir: true, path, label, depth, count: d.count, open });
      if (open) walk(d, path + "/", depth + 1);
    }
    for (const l of n.leaves) out.push({ dir: false, path: prefix + l.label, label: l.label, depth, ref: l.ref });
  };
  walk(root, "", 0);
  return out;
}
