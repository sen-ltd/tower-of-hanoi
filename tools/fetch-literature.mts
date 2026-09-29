// Pull every published number this project checks, straight from its source, into
// tools/literature.json. Nothing in that file is typed by hand.
//   node tools/fetch-literature.mts        (needs network, and pdftotext for the papers)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UA = { 'User-Agent': 'tower-of-hanoi literature check (https://github.com/sen-ltd/tower-of-hanoi)' };
const text = async (url: string) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};
const num = (s: string) => Number(s.replace(/[,\s]/g, ''));
const must = (m: RegExpMatchArray | null, what: string) => {
  if (!m) throw new Error(`pattern not found: ${what}`);
  return m;
};

async function wikipedia(lang: string, title: string) {
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(title)}`
    + '&rvprop=ids|timestamp|content&rvslots=main&format=json&formatversion=2';
  const rev = JSON.parse(await text(api)).query.pages[0].revisions[0];
  return { revision: rev.revid as number, timestamp: rev.timestamp as string, src: rev.slots.main.content as string };
}

// ---------------------------------------------------------------- Wikipedia (en)

const en = await wikipedia('en', 'Tower of Hanoi');
const w = en.src;

const walshBlock = w.slice(w.indexOf("Move 216<sub>10</sub>"), w.indexOf('The source and destination pegs'));
// "disk 8 is on the final peg (2)", "disk 6 is placed on peg 0", "Disk 7 is also 1, so it is stacked on top of disk 8"
const walshPeg: Record<number, number> = {};
for (const m of walshBlock.matchAll(/disk (\d+) is (?:on the final peg \((\d)\)|placed on peg (\d))/gi)) {
  walshPeg[Number(m[1])] = Number(m[2] ?? m[3]);
}
for (const m of walshBlock.matchAll(/Disks? ((?:\d+(?: and )?)+) (?:is|are) also \d, so (?:it is|they are) stacked on top of disk (\d+)/g)) {
  for (const d of m[1].split(' and ')) walshPeg[Number(d)] = walshPeg[Number(m[2])];
}
const moved = must(w.match(/disk (\d+) \(\d+ \+ 1\) is moved from peg (\d) to peg (\d)/), 'move 216');
const bitForms = [...w.matchAll(/from peg ?<code>([^<]+)<\/code> to peg <code>([^<]+)<\/code>/g)].map((m) => ({ from: m[1], to: m[2] }));
const avgMath = must(w.match(/:<math> \\frac\{466\}\{885\}[\s\S]*?<\/math>/), '466/885 formula')[0];
const fracs = [...avgMath.matchAll(/\\frac\{(\d+)\}\{(\d+)\}/g)].map((m) => [Number(m[1]), Number(m[2])]);

const wikipediaEn = {
  source: 'https://en.wikipedia.org/wiki/Tower_of_Hanoi',
  revision: en.revision,
  revisionTimestamp: en.timestamp,
  frameStewart15: Number(must(w.match(/optimal solution for the 15-disk and 4-peg case as (\d+)/), '129')[1]),
  optimalKSentence: must(w.match(/In the 4-peg case, the optimal <math>k<\/math> equals <math>([^<]+)<\/math>/), 'k formula')[1],
  nonSelfCrossing: must(w.match(/''N''<sub>''h''<\/sub> to be ([\d, ]+)/), 'N_h')[1].split(',').map(num).filter((x) => x > 0),
  averageFormula: avgMath,
  averageFractions: fracs,
  linearMovesSentence: must(w.match(/moving a stack of ''n'' disks from peg A to peg C takes 3<sup>''n''<\/sup> − 1 moves/), 'linear')[0],
  linearHalfwaySentence: must(w.match(/The position with all disks at peg B is reached halfway, i\.e\. after \(3<sup>''n''<\/sup> − 1\) \/ 2 moves/), 'halfway')[0],
  walsh216: { disks: 8, move: 216, pegOfDisk: walshPeg, movedDisk: Number(moved[1]), movedFrom: Number(moved[2]), movedTo: Number(moved[3]) },
  bitFormulas: bitForms,
  bitParitySentence: must(w.match(/These hold for odd ''n'' puzzles\.\s+For even ''n'' puzzles, the output references to pegs 1 and 2 need to be reversed\./), 'parity')[0],
  rulerSequence: must(w.match(/gives the size of the disk moved at each step: ([\d, ]+)/), 'ruler')[1].split(',').map(num).filter((x) => x > 0),
  longestSolutionSentence: must(w.match(/it will take them 3<sup>64<\/sup>&nbsp;−&nbsp;1 moves, or more than 10<sup>(\d+)<\/sup> years/), '3^64')[0],
  longestSolutionYearsExponent: Number(must(w.match(/or more than 10<sup>(\d+)<\/sup> years/), 'years')[1]),
  graphClaims: [...w.matchAll(/^\* ((?:From every|Between every)[^\n]+)$/gm)].map((m) => m[1]),
};

// ---------------------------------------------------------------- Wikipedia (ja)

const ja = await wikipedia('ja', 'ハノイの塔');
const j = ja.src;
const jaBits = must(j.match(/「\(n&\(n-1\)\)%3 番目の棒にある円盤を \(\(n\|\(n-1\)\)\+1\)%3 番目の棒に移動する」/), 'ja bit formula')[0];
const wikipediaJa = {
  source: 'https://ja.wikipedia.org/wiki/ハノイの塔',
  revision: ja.revision,
  revisionTimestamp: ja.timestamp,
  goalSentence: must(j.match(/すべての円盤を右端の杭に移動させられれば完成/), 'goal')[0],
  binarySetup: must(j.match(/すべて左端の棒にある状態からすべて右端の棒に移動させる場合、各円盤の位置は以下のように求められる。/), 'setup')[0],
  binaryRules: [
    must(j.match(/最上位が0のとき、一番大きい円盤がまだ動いておらず、1の時には移動済みである。/), 'msb rule')[0],
    must(j.match(/下から\[\[奇数\]\]番目の場合、一回り大きい物の右隣にある。/), 'odd 0 rule')[0],
    must(j.match(/下から\[\[偶数\]\]番目の場合、一回り大きい物の左隣にある。/), 'even 0 rule')[0],
    must(j.match(/下から奇数番目の場合、一回り大きい物の左隣にある。/), 'odd 1 rule')[0],
    must(j.match(/下から偶数番目の場合、一回り大きい物の右隣にある。/), 'even 1 rule')[0],
    must(j.match(/左端の棒の左隣は右端、右端の棒の右隣は左端とする。/), 'wrap rule')[0],
  ],
  bitFormula: jaBits,
  bitFormulaFrom: '(n&(n-1))%3',
  bitFormulaTo: '((n|(n-1))+1)%3',
  mentionsParity: /偶数枚|奇数枚|円盤の枚数が偶数|円盤の数が偶数/.test(j.slice(j.indexOf('2進数の演算'), j.indexOf('=== グレイコード'))),
  smallestCycleEven: must(j.match(/B→C→A→B\(''n''が偶数の場合\)/), 'even cycle')[0],
  smallestCycleOdd: must(j.match(/C→B→A→C\(''n''が奇数の場合\)/), 'odd cycle')[0],
  moves64: must(j.match(/（2<sup>64<\/sup> &minus; 1）回 = ([\d,]+) 回/), '2^64-1')[1].replace(/,/g, ''),
  years64: must(j.match(/約(\d+)億年/), 'years')[1],
  manyPegsSentence: must(j.match(/<math>m>n<\/math>のとき、<br>\s*<math>T\(n\)=2n-1<\/math>/), '2n-1')[0],
};

// ---------------------------------------------------------------- OEIS

async function oeis(id: string) {
  const r = JSON.parse(await text(`https://oeis.org/search?q=id:${id}&fmt=json`));
  const e = (Array.isArray(r) ? r : r.results)[0];
  return { id, name: e.name as string, offset: Number(String(e.offset).split(',')[0]), data: (e.data as string).split(',').map(Number) };
}
const oeisSeqs = Object.fromEntries(await Promise.all(
  ['A007664', 'A382111', 'A125295', 'A000225', 'A001511', 'A024023'].map(async (id) => [id, await oeis(id)]),
));
// A125295 has terms too large for a double; keep them as strings as well.
const a125295 = JSON.parse(await text('https://oeis.org/search?q=id:A125295&fmt=json'));
(oeisSeqs.A125295 as Record<string, unknown>).dataExact = ((Array.isArray(a125295) ? a125295 : a125295.results)[0].data as string).split(',');

// ---------------------------------------------------------------- Korf (2004), Korf & Felner (2007)

const dir = mkdtempSync(join(tmpdir(), 'hanoi-'));
/** The paper as text twice: column layout kept (for tables) and in reading order (for prose). */
async function pdf(url: string) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const file = join(dir, 'paper.pdf');
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  const layout = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  const prose = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  return { layout, prose };
}

const k04url = 'https://cdn.aaai.org/AAAI/2004/AAAI04-103.pdf';
const { layout: k04, prose: flat } = await pdf(k04url);
const k04lines = k04.split('\n');
function rowsAfter(header: RegExp, count: number, row: RegExp) {
  const at = k04lines.findIndex((l) => header.test(l));
  if (at < 0) throw new Error(`header not found: ${header}`);
  const rows: number[][] = [];
  for (const l of k04lines.slice(at + 1)) {
    const m = l.match(row);
    if (m) rows.push(m.slice(1).map(num));
    if (rows.length === count) break;
  }
  return rows;
}
// Table 2 sits in the right-hand column, Table 3 in the left-hand one.
const table2 = rowsAfter(/Disks\s+Depth\s+States\s+Width/, 20, /(\d+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s*$/);
const table3 = rowsAfter(/Disks\s+Moves\s+States\s+Width/, 24, /^\s{0,8}(\d+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)(?:\s{2,}|$)/);
const korf2004 = {
  source: k04url,
  table2: table2.map(([disks, depth, states, width]) => ({ disks, depth, states, width })),
  table3: table3.map(([disks, moves, states, width]) => ({ disks, moves, states, width })),
  anomaly15: must(flat.match(/For 15 disks, however, the optimal solution length is (\d+) moves, but there are (\d+) states at depth (\d+)/), '588').slice(1, 4).map(Number),
  beyond20: must(flat.match(/For 20 disks, there are a total of ([\d, ]+?) states beyond the optimal solution length of (\d+) moves, up to a depth of (\d+)/), '20 disks').slice(1, 4).map(num),
  noExplanation: must(flat.match(/We have no explanation for this surprising anomaly[^.]*\./), 'no explanation')[0],
};

const k07url = 'https://www.ijcai.org/Proceedings/07/Papers/374.pdf';
const { layout: k07layout, prose: k07 } = await pdf(k07url);
const korfFelner2007 = {
  source: k07url,
  anomaly15: must(k07.match(/For the 15-disc problem, (\d+) moves are needed to move all discs from one peg to another, but there exist (\d+) states that are (\d+) moves from the standard initial state/), '588 (2007)').slice(1, 4).map(Number),
  anomaly20: must(k07.match(/For the 20-disc problem, the optimal solution is (\d+) moves, but the radius of the problem from the standard initial state is (\d+) moves/), '20 (2007)').slice(1, 3).map(Number),
  table: [...k07layout.matchAll(/^\s*(2[12])\s+(\d{3})\s+(\d{3})\s+([\d,]{10,})\s+\d+:\d\d:\d\d:\d\d/gm)].map((m) => ({ disks: Number(m[1]), optimal: Number(m[2]), radius: Number(m[3]), width: num(m[4]) })),
  conjecture: must(k07.match(/we conjecture that this is true for all problems with (\d+) or more discs/), 'conjecture')[1],
};

const out = { fetched: new Date().toISOString().slice(0, 10), wikipediaEn, wikipediaJa, oeis: oeisSeqs, korf2004, korfFelner2007 };
writeFileSync(new URL('./literature.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote tools/literature.json: en rev ${en.revision}, ja rev ${ja.revision}, `
  + `Korf table 2 ${table2.length} rows, table 3 ${table3.length} rows, 2007 table ${korfFelner2007.table.length} rows`);
