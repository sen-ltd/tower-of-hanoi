// Tower of Hanoi with any number of pegs (3..5 in the UI). A state is an integer in base
// `pegs`: digit k is the peg of disk k, disk 0 being the smallest. Every legal move takes
// the top (smallest) disk of one peg onto a peg whose top disk is larger, or empty.

export interface Shape {
  pegs: number;
  disks: number;
}

export interface Move {
  disk: number;
  from: number;
  to: number;
  next: number;
}

export const UNSEEN = 0xffff;

export function stateCount({ pegs, disks }: Shape): number {
  return pegs ** disks;
}

export function encode(shape: Shape, pegOf: readonly number[]): number {
  let s = 0;
  for (let k = shape.disks - 1; k >= 0; k--) s = s * shape.pegs + pegOf[k];
  return s;
}

export function decode(shape: Shape, s: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < shape.disks; k++) {
    out.push(s % shape.pegs);
    s = Math.floor(s / shape.pegs);
  }
  return out;
}

/** All disks on one peg. */
export function perfect(shape: Shape, peg: number): number {
  return (peg * (stateCount(shape) - 1)) / (shape.pegs - 1);
}

/** Smallest disk on each peg, -1 for an empty peg. */
export function tops(shape: Shape, s: number): number[] {
  const top = new Array<number>(shape.pegs).fill(-1);
  for (let k = 0; k < shape.disks; k++) {
    const p = s % shape.pegs;
    if (top[p] < 0) top[p] = k;
    s = Math.floor(s / shape.pegs);
  }
  return top;
}

export function moves(shape: Shape, s: number): Move[] {
  const top = tops(shape, s);
  const out: Move[] = [];
  for (let a = 0; a < shape.pegs; a++) {
    if (top[a] < 0) continue;
    for (let b = 0; b < shape.pegs; b++) {
      if (b === a || (top[b] >= 0 && top[b] < top[a])) continue;
      out.push({ disk: top[a], from: a, to: b, next: s + (b - a) * shape.pegs ** top[a] });
    }
  }
  return out;
}

export interface Search {
  shape: Shape;
  source: number;
  /** distance from `source`, UNSEEN if not reached (never, the graph is connected) */
  dist: Uint16Array;
  /** layer[d] = number of states at distance d */
  layer: number[];
}

/** Breadth-first search over every state of the puzzle. Distances are symmetric, so a
 *  search from the goal gives every state's distance to the goal. */
export function bfs(shape: Shape, source: number): Search {
  const { pegs, disks } = shape;
  const n = stateCount(shape);
  const dist = new Uint16Array(n).fill(UNSEEN);
  const queue = new Int32Array(n);
  const pow = Array.from({ length: disks }, (_, k) => pegs ** k);
  const top = new Int32Array(pegs);
  const layer: number[] = [1];
  dist[source] = 0;
  queue[0] = source;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const s = queue[head++];
    const d = dist[s] + 1;
    top.fill(-1);
    let x = s;
    for (let k = 0; k < disks; k++) {
      const p = x % pegs;
      if (top[p] < 0) top[p] = k;
      x = (x - p) / pegs;
    }
    for (let a = 0; a < pegs; a++) {
      const ta = top[a];
      if (ta < 0) continue;
      for (let b = 0; b < pegs; b++) {
        if (b === a || (top[b] >= 0 && top[b] < ta)) continue;
        const u = s + (b - a) * pow[ta];
        if (dist[u] !== UNSEEN) continue;
        dist[u] = d;
        queue[tail++] = u;
        if (layer.length === d) layer.push(0);
        layer[d]++;
      }
    }
  }
  return { shape, source, dist, layer };
}

/** A shortest path from `s` to the search's source, following the distance table downhill.
 *  Ties go to the first move in `moves` order, so the path is deterministic. */
export function pathToSource(search: Search, s: number): Move[] {
  const out: Move[] = [];
  let d = search.dist[s];
  while (d > 0) {
    const m = moves(search.shape, s).find((mv) => search.dist[mv.next] === d - 1);
    if (!m) throw new Error('distance table is inconsistent');
    out.push(m);
    s = m.next;
    d--;
  }
  return out;
}

/** Frame–Stewart: move k disks aside with all pegs, the other n-k with one peg fewer,
 *  then the k back. T(n, 3) = 2^n - 1. Exact integers up to 2^53. */
export function frameStewart(disks: number, pegs: number): number {
  return fsTable(pegs, disks)[disks].moves;
}

/** Every k attaining the Frame–Stewart minimum for n disks. */
export function frameStewartSplits(disks: number, pegs: number): number[] {
  return fsTable(pegs, disks)[disks].splits;
}

const fsCache = new Map<number, { moves: number; splits: number[] }[]>();

function fsTable(pegs: number, upTo: number) {
  if (pegs < 3) throw new Error('need at least three pegs');
  let t = fsCache.get(pegs);
  if (!t) fsCache.set(pegs, (t = [{ moves: 0, splits: [] }, { moves: 1, splits: [] }]));
  while (t.length <= upTo) {
    const n = t.length;
    if (pegs === 3) {
      t.push({ moves: 2 * t[n - 1].moves + 1, splits: [n - 1] });
      continue;
    }
    let best = Infinity;
    let splits: number[] = [];
    for (let k = 1; k < n; k++) {
      const v = 2 * t[k].moves + frameStewart(n - k, pegs - 1);
      if (v < best) { best = v; splits = [k]; } else if (v === best) splits.push(k);
    }
    t.push({ moves: best, splits });
  }
  return t;
}

/** Three pegs only: distance from any state to "all disks on `peg`", in O(disks).
 *  The largest disk not already on the target must move exactly once, onto the target,
 *  with everything smaller stacked on the third peg (Hinz). */
export function distanceToPerfect3(disks: number, pegOf: readonly number[], peg: number): number {
  let target = peg;
  let d = 0;
  for (let k = disks - 1; k >= 0; k--) {
    if (pegOf[k] !== target) {
      d += 2 ** k;
      target = 3 - pegOf[k] - target;
    }
  }
  return d;
}

/** The classical recursive solution for three pegs, as (disk, from, to) with disk 1 the
 *  smallest, matching how Wikipedia numbers disks. */
export function classicalSolution(disks: number, from = 0, to = 2): [number, number, number][] {
  const out: [number, number, number][] = [];
  const go = (n: number, f: number, t: number, o: number) => {
    if (n === 0) return;
    go(n - 1, f, o, t);
    out.push([n, f, t]);
    go(n - 1, o, t, f);
  };
  go(disks, from, to, 3 - from - to);
  return out;
}
