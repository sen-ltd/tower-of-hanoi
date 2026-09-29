// Builds src/stats.json: every published value next to the value computed here.
//   node tools/stats.mts
//
// The large 4-peg searches (up to 17 disks) are done by tools/radius.c; their logs are
// committed in tools/runs/. This script re-runs the same search in TypeScript for every
// size up to 10 disks and stops if a single layer count differs, so the C logs cannot
// drift from the code in src/.
//
//   cc -O3 -o /tmp/radius tools/radius.c -lpthread
//   for n in $(seq 1 17); do /tmp/radius $n 16 tools/runs/far-$n.txt > tools/runs/bfs-$n.log; done
//   cc -O3 -o /tmp/anomaly tools/anomaly.c -lpthread
//   /tmp/anomaly 15 tools/runs/far-15.txt 16 > tools/runs/anomaly-15.log
//   cc -O3 -o /tmp/paths tools/paths.c -lpthread && /tmp/paths 4 16 > tools/runs/paths-4.log

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { literatureChecks, type Check } from '../src/checks.ts';
import { bfs, frameStewart, perfect } from '../src/hanoi.ts';

const lit = JSON.parse(readFileSync(new URL('./literature.json', import.meta.url), 'utf8'));
const runs = new URL('./runs/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, runs), 'utf8');
const MAX = Number(process.env.MAX ?? 17);

const t0 = Date.now();
const checks: Check[] = literatureChecks(lit, { maxAllPairs: 7, maxLinear: 8 });
const add = (id: string, source: string, claim: string, published: unknown, computed: unknown) =>
  checks.push({ id, source, claim, published: String(published), computed: String(computed), ok: String(published) === String(computed) });

// ------------------------------------------------------------------ C search logs

interface Run { disks: number; layers: number[]; canon: number[]; radius: number; width: number; goal: number; reached: number }
function parseRun(n: number): Run {
  const text = read(`bfs-${n}.log`);
  const layers: number[] = [];
  const canon: number[] = [];
  for (const m of text.matchAll(/^depth (\d+) (\d+) (\d+)$/gm)) {
    if (Number(m[1]) !== layers.length) throw new Error(`bfs-${n}.log: depth out of order`);
    layers.push(Number(m[2]));
    canon.push(Number(m[3]));
  }
  const field = (k: string) => Number(text.match(new RegExp(`^${k} (-?\\d+)$`, 'm'))![1]);
  return { disks: n, layers, canon, radius: field('radius'), width: field('width'), goal: field('goal'), reached: field('reached') };
}
const all = Array.from({ length: MAX }, (_, i) => parseRun(i + 1));

// the TypeScript search must reproduce the C logs layer by layer
for (const run of all.slice(0, 10)) {
  const shape = { pegs: 4, disks: run.disks };
  const ts = bfs(shape, perfect(shape, 0));
  if (ts.layer.join() !== run.layers.join()) throw new Error(`TypeScript and C disagree at ${run.disks} disks`);
  if (ts.dist[perfect(shape, 1)] !== run.goal) throw new Error(`goal depth differs at ${run.disks} disks`);
}

const rows = all.map((r) => {
  const fs = frameStewart(r.disks, 4);
  if (r.reached !== 4 ** r.disks) throw new Error(`bfs-${r.disks}.log did not reach every state`);
  const t2 = lit.korf2004.table2.find((x: { disks: number }) => x.disks === r.disks);
  const t3 = lit.korf2004.table3.find((x: { disks: number }) => x.disks === r.disks);
  const half = Math.ceil(r.goal / 2);
  const halfStates = r.canon.slice(0, half + 1).reduce((a, b) => a + b, 0);
  const halfWidth = r.canon[half];
  const beyond = r.layers.slice(fs + 1).reduce((a, b) => a + b, 0);
  add(`korf-t2-${r.disks}`, 'Korf 2004, Table 2', `${r.disks} disks: depth, states, width of a complete search from one peg`,
    `${t2.depth} ${t2.states} ${t2.width}`, `${r.radius} ${4 ** r.disks} ${r.width}`);
  add(`korf-t3-${r.disks}`, 'Korf 2004, Table 3', `${r.disks} disks: moves, states up to half depth (rounded up), width there, one per relabelling of the free pegs`,
    `${t3.moves} ${t3.states} ${t3.width}`, `${r.goal} ${halfStates} ${halfWidth}`);
  return {
    disks: r.disks, optimal: r.goal, frameStewart: fs, radius: r.radius, farthest: r.layers[r.radius], beyond,
    width: r.width, table2: t2.depth === r.radius && t2.width === r.width && t2.states === 4 ** r.disks,
    halfStates, halfWidth, table3: t3.moves === r.goal && t3.states === halfStates && t3.width === halfWidth,
  };
});

add('A382111', 'OEIS A382111', `radius from all disks on one peg, n = 0..${MAX}`,
  lit.oeis.A382111.data.slice(0, MAX + 1).join(','), [0, ...rows.map((r) => r.radius)].join(','));
add('A007664-bfs', 'OEIS A007664', `Frame–Stewart equals the true optimum found by complete search, n = 0..${MAX}`,
  lit.oeis.A007664.data.slice(0, MAX + 1).join(','), [0, ...rows.map((r) => r.optimal)].join(','));
const [k04opt, k04far, k04depth] = lit.korf2004.anomaly15;
const [k07opt, k07far, k07depth] = lit.korfFelner2007.anomaly15;
const r15 = rows[14];
add('anomaly-2004', 'Korf 2004, text', '15 disks: optimal solution, states at the radius, radius',
  `${k04opt} ${k04far} ${k04depth}`, `${r15.optimal} ${r15.farthest} ${r15.radius}`);
add('anomaly-2007', 'Korf & Felner 2007, text', '15 disks: moves needed, states at the radius, radius',
  `${k07opt} ${k07far} ${k07depth}`, `${r15.optimal} ${r15.farthest} ${r15.radius}`);

// ------------------------------------------------------------------ the 588

const far15 = read('far-15.txt').trim().split('\n');
/** Relabel pegs 1..3 in order of first appearance from the largest disk down. */
function canonical(digits: string): string {
  const map = new Map([['0', '0']]);
  let next = 1;
  const out = [...digits].reverse().map((c) => {
    if (!map.has(c)) map.set(c, String(next++));
    return map.get(c)!;
  });
  return out.reverse().join('');
}
const orbitSet = new Set(far15.map(canonical));
const orbits = [...orbitSet].sort((a, b) => [...b].reverse().join('').localeCompare([...a].reverse().join('')));
const bigAway = far15.every((s) => s[14] !== '0');
const patterns: Record<string, number> = {};
for (const o of orbits) {
  const top4 = [...o].reverse().slice(0, 4).join(''); // largest first
  patterns[top4] = (patterns[top4] ?? 0) + 1;
}
const orbitSizes = [...orbitSet].map((o) => far15.filter((s) => canonical(s) === o).length);
if (!orbitSizes.every((x) => x === 6)) throw new Error('an orbit of the 588 is not of size 6');

// what the farthest states look like for every size: the largest disk off the start peg?
const farShape = rows.map((r) => {
  const f = `far-${r.disks}.txt`;
  if (!existsSync(new URL(f, runs))) return null;
  const states = read(f).trim().split('\n');
  const perfectCount = states.filter((s) => new Set(s).size === 1).length;
  return { disks: r.disks, count: states.length, perfect: perfectCount, bigDiskAway: states.filter((s) => s[s.length - 1] !== '0').length };
});

let split: Record<string, unknown> | null = null;
if (existsSync(new URL('anomaly-15.log', runs))) {
  const a = read('anomaly-15.log');
  const tight = a.match(/bound-tight (\d+) bound-loose (\d+)/);
  const fars = [...a.matchAll(/^far (\d+) exact (\d+) once (\d+) near (\d+)(?: splits (.*))?$/gm)];
  const perfectLine = a.match(/^perfect exact (\d+) once (\d+)$/m);
  const gate = a.match(/nearest-to-home (\d+)/);
  const nearCount = a.match(/^nearest gateways (\d+)$/m);
  if (tight && perfectLine && gate && nearCount && fars.length) {
    const loose = [...a.matchAll(/^ {2}loose-by (\d+): (\d+)$/gm)].map((m) => ({ by: Number(m[1]), count: Number(m[2]) }));
    const g = Number(gate[1]);
    split = {
      statesWithBigDiskAway: Number(tight[1]) + Number(tight[2]),
      tight: Number(tight[1]),
      loose: Number(tight[2]),
      looseBy: loose,
      analysed: fars.length,
      allOnceOptimal: fars.every((f) => f[2] === f[3]),
      exact: [...new Set(fars.map((f) => Number(f[2])))],
      nearestGatewayToHome: g,
      nearestGateways: Number(nearCount[1]),
      nearDistances: [...new Set(fars.map((f) => Number(f[4])))],
      // how far the smaller disks of each farthest state are from the gateways nearest to home
      nearHist: fars.reduce<Record<string, number>>((h, f) => ({ ...h, [f[4]]: (h[f[4]] ?? 0) + 1 }), {}),
      examples: fars.filter((f) => f[5]).map((f) => ({ state: f[1], splits: f[5].trim().split(' ') })),
      perfect: { exact: Number(perfectLine[1]), once: Number(perfectLine[2]) },
    };
  }
}

// ------------------------------------------------------------------ simple paths, 4 disks

let paths4: string | null = null;
if (existsSync(new URL('paths-4.log', runs))) {
  const m = read('paths-4.log').match(/disks 4 vertices 81 prefixes \d+ paths (\d+)/);
  if (m) {
    paths4 = m[1];
    add('A125295-4', 'Wikipedia (en); OEIS A125295', 'non-self-crossing paths for 4 disks, walked one by one by tools/paths.c',
      lit.wikipediaEn.nonSelfCrossing[3], paths4);
  }
}

// ------------------------------------------------------------------ write

const expected = ['ja-bitwise', 'korf-t3-1'];
const failing = checks.filter((c) => !c.ok).map((c) => c.id);
const unexpected = [
  ...failing.filter((id) => !expected.includes(id)),
  ...expected.filter((id) => !failing.includes(id)).map((id) => `${id} (expected to differ, but matches)`),
];

const out = {
  generated: new Date().toISOString().slice(0, 10),
  summary: { total: checks.length, ok: checks.length - failing.length, failing },
  expected,
  unexpected,
  korfQuote: lit.korf2004.noExplanation,
  korf: {
    rows,
    anomaly15: { optimal: r15.optimal, radius: r15.radius, farthest: r15.farthest, orbits: orbits.length },
    layers15: all[14].layers,
    farthest15: orbits,
    patterns15: patterns,
    bigDiskAway15: bigAway,
    farShape,
    split,
    quoted: {
      table2Beyond: lit.korf2004.table2.slice(MAX).map((r: { disks: number; depth: number }) => ({ disks: r.disks, radius: r.depth, optimal: frameStewart(r.disks, 4) })),
      felner2007: lit.korfFelner2007.table,
      beyond20: lit.korf2004.beyond20,
    },
  },
  paths4,
  checks,
};
writeFileSync(new URL('../src/stats.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`${out.summary.ok}/${out.summary.total} reproduce; failing: ${failing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}; ${Date.now() - t0} ms`);
if (unexpected.length) process.exit(1);
