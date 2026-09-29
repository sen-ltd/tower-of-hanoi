import { describe, expect, it } from 'vitest';
import lit from '../tools/literature.json';
import { averageFormulaTimesPairs, literatureChecks, totalDistance3 } from './checks.ts';
import {
  bfs, classicalSolution, decode, distanceToPerfect3, encode, frameStewart, moves, pathToSource,
  perfect, stateCount,
} from './hanoi.ts';
import stats from './stats.json';

describe('state encoding and moves', () => {
  it('round-trips every state and only makes legal moves', () => {
    const shape = { pegs: 4, disks: 5 };
    for (let s = 0; s < stateCount(shape); s++) {
      const pegOf = decode(shape, s);
      expect(encode(shape, pegOf)).toBe(s);
      for (const m of moves(shape, s)) {
        const after = decode(shape, m.next);
        // only the moved disk changes, and it was the smallest on both pegs
        pegOf.forEach((p, k) => expect(after[k]).toBe(k === m.disk ? m.to : p));
        for (let k = 0; k < m.disk; k++) expect([m.from, m.to]).not.toContain(pegOf[k]);
      }
    }
  });
});

describe('four pegs against Korf (2004), Table 2', () => {
  it('reproduces depth, state count and width for 1..8 disks from all on one peg', () => {
    for (const row of lit.korf2004.table2.slice(0, 8)) {
      const shape = { pegs: 4, disks: row.disks };
      const { layer } = bfs(shape, perfect(shape, 0));
      expect([layer.length - 1, stateCount(shape), Math.max(...layer)]).toEqual([row.depth, row.states, row.width]);
    }
  });
});

describe('Frame–Stewart', () => {
  it('is the true optimum for 4 pegs up to 9 disks and 5 pegs up to 7', () => {
    for (const [pegs, max] of [[4, 9], [5, 7]]) {
      for (let disks = 1; disks <= max; disks++) {
        const shape = { pegs, disks };
        expect(bfs(shape, perfect(shape, 0)).dist[perfect(shape, pegs - 1)]).toBe(frameStewart(disks, pegs));
      }
    }
  });
});

describe('three pegs', () => {
  it('closed-form distance to a perfect state agrees with search', () => {
    for (let disks = 1; disks <= 7; disks++) {
      const shape = { pegs: 3, disks };
      for (let peg = 0; peg < 3; peg++) {
        const { dist } = bfs(shape, perfect(shape, peg));
        for (let s = 0; s < dist.length; s++) expect(distanceToPerfect3(disks, decode(shape, s), peg)).toBe(dist[s]);
      }
    }
  });

  it('the recursive solution is 2^n - 1 legal moves ending on the target', () => {
    for (let disks = 1; disks <= 10; disks++) {
      const shape = { pegs: 3, disks };
      let s = perfect(shape, 0);
      const sol = classicalSolution(disks);
      for (const [d, f, t] of sol) {
        const m = moves(shape, s).find((x) => x.disk === d - 1 && x.from === f && x.to === t);
        expect(m).toBeDefined();
        s = m!.next;
      }
      expect([sol.length, s]).toEqual([2 ** disks - 1, perfect(shape, 2)]);
    }
  });

  it('466/885: the exact formula times 9^n is the sum of all pairwise distances', () => {
    for (let n = 1; n <= 5; n++) {
      expect(averageFormulaTimesPairs(n, lit.wikipediaEn.averageFractions)).toBe(totalDistance3(n).toString());
    }
  });
});

describe('solving', () => {
  it('pathToSource walks a shortest path from every state', () => {
    const shape = { pegs: 4, disks: 4 };
    const search = bfs(shape, perfect(shape, 3));
    for (let s = 0; s < stateCount(shape); s++) {
      const path = pathToSource(search, s);
      expect(path.length).toBe(search.dist[s]);
      expect(path.length ? path[path.length - 1].next : s).toBe(perfect(shape, 3));
    }
  });
});

describe('published claims', () => {
  const checks = literatureChecks(lit, { maxAllPairs: 4, maxLinear: 5 });
  it('every Wikipedia and OEIS value reproduces except the Japanese bit formula', () => {
    expect(checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(['ja-bitwise']);
  });
  it('the Japanese formula lands on the middle peg for an even number of disks', () => {
    expect(checks.find((c) => c.id === 'ja-bitwise')!.computed).toBe('RMRMRMRMRMRM');
  });
});

describe('shipped stats', () => {
  it('stats.json was generated with no unexpected mismatch', () => {
    expect(stats.unexpected).toEqual([]);
    expect(stats.korf.anomaly15).toEqual({ optimal: 129, radius: 130, farthest: 588, orbits: 98 });
  });
});
