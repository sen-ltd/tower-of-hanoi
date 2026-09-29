// Every published claim this project checks, recomputed from scratch. The published side
// comes from tools/literature.json (fetched, not typed); the computed side from the
// searches in hanoi.ts. tools/stats.mts runs these and the tests assert them.

import {
  bfs, classicalSolution, decode, distanceToPerfect3, encode, frameStewart, frameStewartSplits,
  moves, perfect, stateCount, type Shape,
} from './hanoi.ts';

export interface Check {
  id: string;
  source: string;
  claim: string;
  published: string;
  computed: string;
  ok: boolean;
}

// ------------------------------------------------------------------ exact arithmetic

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
class Q {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  add(o: Q) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Q) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Q) { return new Q(this.n * o.n, this.d * o.d); }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}
const q = (a: number, b = 1) => new Q(BigInt(a), BigInt(b));

/** Hinz/Chan average distance in the 3-peg graph, evaluated exactly. Coefficients are the
 *  fractions as they appear in the Wikipedia formula, in order:
 *  466/885, 1/3, 3/5, 1/3, 12/59, 18/1003, 12/59, 18/1003; the root is sqrt 17 over 18. */
export function averageFormulaExact(n: number, fr: number[][]): Q {
  const f = fr.map(([a, b]) => q(a, b));
  let t = f[0].mul(new Q(2n ** BigInt(n))).sub(f[1]).sub(f[2].mul(new Q(1n, 3n ** BigInt(n))));
  // (5 + sqrt17)^n = p + r sqrt17
  let p = 1n;
  let r = 0n;
  for (let i = 0; i < n; i++) [p, r] = [5n * p + 17n * r, p + 5n * r];
  // (c + e sqrt17)(p + r sqrt17)/18^n plus its conjugate = 2 (c p + 17 e r)/18^n
  const c = f[4];
  const e = f[5];
  const rational = c.mul(new Q(p)).add(e.mul(new Q(17n * r)));
  t = t.add(rational.mul(new Q(2n, 18n ** BigInt(n))));
  return t;
}

/** The formula's value times 9^n (the number of ordered pairs), as an exact rational. */
export function averageFormulaTimesPairs(n: number, fr: number[][]): string {
  return averageFormulaExact(n, fr).mul(new Q(9n ** BigInt(n))).toString();
}

/** Sum of d(s, t) over all ordered pairs of states, 3 pegs. */
export function totalDistance3(disks: number): bigint {
  const shape = { pegs: 3, disks };
  let sum = 0n;
  for (let s = 0; s < stateCount(shape); s++) {
    let part = 0;
    for (const d of bfs(shape, s).dist) part += d;
    sum += BigInt(part);
  }
  return sum;
}

// ------------------------------------------------------------------ path counting (3 pegs)

function adjacency(shape: Shape): number[][] {
  return Array.from({ length: stateCount(shape) }, (_, s) => moves(shape, s).map((m) => m.next));
}

/** Number of shortest paths from `s` to every state (BFS layer DP). */
export function shortestPathCounts(shape: Shape, s: number): { dist: Uint16Array; count: number[] } {
  const { dist } = bfs(shape, s);
  const adj = adjacency(shape);
  const order = [...dist.keys()].sort((a, b) => dist[a] - dist[b]);
  const count = new Array<number>(dist.length).fill(0);
  count[s] = 1;
  for (const v of order) for (const u of adj[v]) if (dist[u] === dist[v] + 1) count[u] += count[v];
  return { dist, count };
}

/** Simple paths from `s`: for every target, the longest length and how many attain it. */
export function longestSimplePaths(shape: Shape, s: number): { len: number[]; count: number[] } {
  const adj = adjacency(shape);
  const len = new Array<number>(adj.length).fill(-1);
  const count = new Array<number>(adj.length).fill(0);
  const seen = new Uint8Array(adj.length);
  const go = (v: number, l: number) => {
    if (l > len[v]) { len[v] = l; count[v] = 1; } else if (l === len[v]) count[v]++;
    seen[v] = 1;
    for (const u of adj[v]) if (!seen[u]) go(u, l + 1);
    seen[v] = 0;
  };
  go(s, 0);
  return { len, count };
}

/** Simple paths between two perfect states, counted by walking every one of them. */
export function simplePathCount(disks: number): number {
  const shape = { pegs: 3, disks };
  const adj = adjacency(shape);
  const goal = perfect(shape, 1);
  const seen = new Uint8Array(adj.length);
  const go = (v: number): number => {
    if (v === goal) return 1;
    seen[v] = 1;
    let c = 0;
    for (const u of adj[v]) if (!seen[u]) c += go(u);
    seen[v] = 0;
    return c;
  };
  return go(perfect(shape, 0));
}

// ------------------------------------------------------------------ the checks

/* eslint-disable @typescript-eslint/no-explicit-any */
export function literatureChecks(lit: any, opts = { maxAllPairs: 6, maxLinear: 7 }): Check[] {
  const out: Check[] = [];
  const add = (id: string, source: string, claim: string, published: unknown, computed: unknown) =>
    out.push({ id, source, claim, published: String(published), computed: String(computed), ok: String(published) === String(computed) });
  const en = lit.wikipediaEn;
  const ja = lit.wikipediaJa;
  const enSrc = `Wikipedia (en) rev ${en.revision}`;
  const jaSrc = `Wikipedia (ja) rev ${ja.revision}`;

  // Frame–Stewart numbers against OEIS A007664, and 129 for 15 disks
  const a7664 = lit.oeis.A007664.data as number[];
  add('A007664', 'OEIS A007664', `Frame–Stewart numbers, 4 pegs, n = 0..${a7664.length - 1}`,
    a7664.join(','), a7664.map((_, n) => frameStewart(n, 4)).join(','));
  add('fs15', enSrc, 'the optimal solution for 15 disks and 4 pegs is 129 moves', en.frameStewart15, frameStewart(15, 4));

  // the optimal split k = n - round(sqrt(2n+1)) + 1 is always one of the minimisers
  let kBad = 0;
  for (let n = 2; n <= 1000; n++) {
    const k = n - Math.round(Math.sqrt(2 * n + 1)) + 1;
    if (!frameStewartSplits(n, 4).includes(k)) kBad++;
  }
  add('split-k', enSrc, `optimal k = ${en.optimalKSentence} (checked n = 2..1000: number of n where it is not a minimiser)`, 0, kBad);

  // 3 pegs: 2^n - 1, and exactly one shortest path to each perfect state
  add('A000225', 'OEIS A000225', '3 pegs: 2^n - 1 moves', lit.oeis.A000225.data.slice(0, 16).join(','),
    Array.from({ length: 16 }, (_, n) => frameStewart(n, 3)).join(','));
  {
    let many = 0;
    let pairsMax = 0;
    for (let disks = 1; disks <= 5; disks++) {
      const shape = { pegs: 3, disks };
      for (let peg = 0; peg < 3; peg++) {
        const { count } = shortestPathCounts(shape, perfect(shape, peg));
        many += count.filter((c) => c !== 1).length;
      }
      for (let s = 0; s < stateCount(shape); s++) pairsMax = Math.max(pairsMax, ...shortestPathCounts(shape, s).count);
    }
    add('unique-to-perfect', enSrc, en.graphClaims[0] + ' (states with more than one, n <= 5)', 0, many);
    add('one-or-two', enSrc, en.graphClaims[1] + ' (largest number of shortest paths, n <= 5)', 2, pairsMax);
  }
  {
    let toCorner = 0;
    let anyPair = 0;
    for (let disks = 1; disks <= 3; disks++) {
      const shape = { pegs: 3, disks };
      const corners = [0, 1, 2].map((p) => perfect(shape, p));
      for (let s = 0; s < stateCount(shape); s++) {
        const { count } = longestSimplePaths(shape, s);
        count.forEach((c, t) => {
          if (t === s) return;
          anyPair = Math.max(anyPair, c);
          if (corners.includes(t)) toCorner = Math.max(toCorner, c);
        });
      }
    }
    add('longest-to-perfect', enSrc, en.graphClaims[2] + ' (largest count, n <= 3)', 2, toCorner);
    add('longest-any', enSrc, en.graphClaims[3] + ' (largest count, n <= 3)', 2, anyPair);
  }
  add('A125295', `${enSrc}; OEIS A125295`, 'non-self-crossing paths between two perfect states, walked one by one (n = 1..3)',
    en.nonSelfCrossing.slice(0, 3).join(','), [1, 2, 3].map(simplePathCount).join(','));
  add('A125295-oeis', 'OEIS A125295', 'Wikipedia list is OEIS A125295 from n = 1',
    lit.oeis.A125295.dataExact.slice(1, 1 + en.nonSelfCrossing.length).join(','), en.nonSelfCrossing.join(','));

  // Hinz & Chan: average distance between two random states
  for (let n = 1; n <= opts.maxAllPairs; n++) {
    const total = totalDistance3(n);
    add(`avg-${n}`, enSrc, `466/885 formula, n = ${n}: formula x 9^n equals the sum over all ordered pairs`,
      averageFormulaTimesPairs(n, en.averageFractions), total.toString());
  }

  // linear Hanoi (moves only between neighbouring pegs)
  for (let n = 1; n <= opts.maxLinear; n++) {
    const { dist, onPath, halfway } = linearHanoi(n);
    add(`linear-${n}`, enSrc, `linear Hanoi, ${n} disks: 3^n - 1 moves, every state used, all on B at (3^n - 1)/2`,
      `${3 ** n - 1}/${3 ** n}/${(3 ** n - 1) / 2}`, `${dist}/${onPath}/${halfway}`);
  }
  add('A024023', 'OEIS A024023', `linear Hanoi lengths 3^n - 1, n = 1..${opts.maxLinear}`,
    lit.oeis.A024023.data.slice(1, opts.maxLinear + 1).join(','),
    Array.from({ length: opts.maxLinear }, (_, i) => linearHanoi(i + 1).dist).join(','));

  // binary solution (Walsh): state after move 216 of 8 disks, and the move itself
  {
    const sol = classicalSolution(8, 0, 2);
    const pos = new Array<number>(9).fill(0);
    for (const [d, , t] of sol.slice(0, 216)) pos[d] = t;
    const pub = en.walsh216.pegOfDisk;
    add('walsh-216', enSrc, 'binary rules, 8 disks after move 216: peg of disks 8..1',
      [8, 7, 6, 5, 4, 3, 2, 1].map((d) => pub[d]).join(''), [8, 7, 6, 5, 4, 3, 2, 1].map((d) => pos[d]).join(''));
    const [d, f, t] = sol[215];
    add('walsh-216-move', enSrc, 'move 216 moves disk 4 from peg 2 to peg 1',
      `${en.walsh216.movedDisk} ${en.walsh216.movedFrom}->${en.walsh216.movedTo}`, `${d} ${f}->${t}`);
  }
  // the bitwise formulas, evaluated as written (the C expressions are also valid JavaScript)
  en.bitFormulas.forEach((fm: { from: string; to: string }, i: number) => {
    const from = new Function('m', `return ${fm.from};`) as (m: number) => number;
    const to = new Function('m', `return ${fm.to};`) as (m: number) => number;
    const swap = [0, 2, 1];
    const res: string[] = [];
    for (let n = 1; n <= 12; n++) {
      const sol = classicalSolution(n, 0, 2);
      const fix = (p: number) => (n % 2 ? p : swap[p]);
      res.push(sol.every(([, f, t], j) => fix(from(j + 1)) === f && fix(to(j + 1)) === t) ? 'y' : 'n');
    }
    add(`bitwise-${i + 1}`, enSrc, `from ${fm.from} to ${fm.to}, pegs 1 and 2 swapped for even n (n = 1..12)`, 'y'.repeat(12), res.join(''));
  });
  add('ruler', `${enSrc}; OEIS A001511`, 'disk moved at each step is the ruler function',
    en.rulerSequence.join(','), classicalSolution(4).map(([d]) => d).join(','));
  add('A001511', 'OEIS A001511', 'ruler function, first 63 terms', lit.oeis.A001511.data.slice(0, 63).join(','),
    classicalSolution(6).map(([d]) => d).join(','));
  {
    const moves64 = 3n ** 64n - 1n;
    const years = moves64 / 31_557_600n; // one move a second, Julian years
    add('longest-64', enSrc, '3^64 - 1 moves at one a second is more than 10^23 years (exponent of the year count)',
      en.longestSolutionYearsExponent, years.toString().length - 1);
  }

  // Japanese article: play the formula's moves on a real board and see where the tower ends
  {
    const from = new Function('n', `return ${ja.bitFormulaFrom};`) as (n: number) => number;
    const to = new Function('n', `return ${ja.bitFormulaTo};`) as (n: number) => number;
    const res: string[] = [];
    for (let disks = 1; disks <= 12; disks++) {
      const pegs: number[][] = [Array.from({ length: disks }, (_, i) => disks - i), [], []];
      let legal = true;
      for (let m = 1; m < 2 ** disks && legal; m++) {
        const a = pegs[from(m)];
        const b = pegs[to(m)];
        if (!a.length || (b.length && b[b.length - 1] < a[a.length - 1])) legal = false;
        else b.push(a.pop()!);
      }
      res.push(!legal ? 'x' : pegs[2].length === disks ? 'R' : pegs[1].length === disks ? 'M' : '?');
    }
    add('ja-bitwise', jaSrc, `${ja.bitFormula} played on a board: where the tower ends (R = right peg 2, M = middle peg 1), disks = 1..12`,
      'R'.repeat(12), res.join(''));
  }
  {
    // 2進数による解析: bit k (from the top) is disk n-k; the top bit says left (0) or right (1) end; a bit equal
    // to the one above means "on the next larger disk"; otherwise 0 -> right neighbour at odd position from the
    // bottom (the largest disk is 1st), left at even; 1 -> the reverse. Neighbours wrap around.
    let bad = 0;
    for (let disks = 1; disks <= 10; disks++) {
      const sol = classicalSolution(disks, 0, 2);
      const pos = new Array<number>(disks + 1).fill(0);
      for (let m = 0; m < 2 ** disks; m++) {
        if (m > 0) pos[sol[m - 1][0]] = sol[m - 1][2];
        let peg = (m >> (disks - 1)) & 1 ? 2 : 0;
        if (pos[disks] !== peg) { bad++; continue; }
        for (let i = 1; i < disks; i++) {
          const bit = (m >> (disks - 1 - i)) & 1;
          const above = (m >> (disks - i)) & 1;
          if (bit !== above) {
            const odd = (i + 1) % 2 === 1;
            const right = bit === 0 ? odd : !odd;
            peg = (peg + (right ? 1 : 2)) % 3;
          }
          if (pos[disks - i] !== peg) { bad++; break; }
        }
      }
    }
    add('ja-binary', jaSrc, `${ja.binaryRules.length} rules reading each disk's peg from the binary move count (states that disagree, disks 1..10)`, 0, bad);
  }
  add('ja-2^64', jaSrc, '2^64 - 1 = 18,446,744,073,709,551,615', ja.moves64, (2n ** 64n - 1n).toString());
  add('ja-years', jaSrc, 'at one move a second, about 5845 hundred-million years (億年, Julian years)',
    ja.years64, ((2n ** 64n - 1n) / 31_557_600n / 100_000_000n).toString());
  {
    // T(n) = 2n - 1 when there are more pegs than disks; check against a full search
    const bad: string[] = [];
    for (let pegs = 4; pegs <= 6; pegs++) {
      for (let disks = 1; disks < pegs; disks++) {
        const shape = { pegs, disks };
        const d = bfs(shape, perfect(shape, 0)).dist[perfect(shape, pegs - 1)];
        if (d !== 2 * disks - 1) bad.push(`${pegs}/${disks}`);
      }
    }
    add('ja-2n-1', jaSrc, 'more pegs than disks: 2n - 1 moves (pegs 4..6, every n < pegs; failures listed)', 'none', bad.join(' ') || 'none');
  }
  {
    // the smallest disk's first three destinations, closed into a cycle
    const cycle = (disks: number) => {
      const dest = classicalSolution(disks, 0, 2).filter(([d]) => d === 1).slice(0, 3).map(([, , t]) => 'ABC'[t]);
      return [...dest, dest[0]].join('→');
    };
    add('ja-cycle', jaSrc, 'smallest disk cycles B→C→A→B for even n, C→B→A→C for odd n',
      `${ja.smallestCycleEven.split('(')[0]} ${ja.smallestCycleOdd.split('(')[0]}`, `${cycle(4)} ${cycle(5)}`);
  }
  return out;
}

/** Three pegs in a row, moves only between neighbours: length of the shortest move of the
 *  tower from A to C, how many states that path visits, and when it passes all-on-B. */
export function linearHanoi(disks: number): { dist: number; onPath: number; halfway: number } {
  const shape = { pegs: 3, disks };
  const n = stateCount(shape);
  const next = (s: number) => moves(shape, s).filter((m) => Math.abs(m.from - m.to) === 1).map((m) => m.next);
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const queue = [perfect(shape, 0)];
  dist[queue[0]] = 0;
  for (let h = 0; h < queue.length; h++) {
    for (const u of next(queue[h])) {
      if (dist[u] >= 0) continue;
      dist[u] = dist[queue[h]] + 1;
      prev[u] = queue[h];
      queue.push(u);
    }
  }
  const goal = perfect(shape, 2);
  const path: number[] = [];
  for (let s = goal; s >= 0; s = prev[s]) path.push(s);
  path.reverse();
  return { dist: dist[goal], onPath: new Set(path).size, halfway: path.indexOf(perfect(shape, 1)) };
}

export { decode, encode, distanceToPerfect3 };
