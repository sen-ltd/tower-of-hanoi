import './style.css';
import { decode, encode, frameStewart, moves, perfect, stateCount, UNSEEN, type Move, type Shape } from './hanoi.ts';
import stats from './stats.json';

const MAX_DISKS: Record<number, number> = { 3: 14, 4: 12, 5: 10 };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');

const pegsSel = $<HTMLSelectElement>('pegsSel');
const disksSel = $<HTMLSelectElement>('disksSel');
const goalSel = $<HTMLSelectElement>('goalSel');
const board = $<HTMLDivElement>('board');
const statusEl = $<HTMLDivElement>('status');
const distEl = $<HTMLDivElement>('dist');
const histEl = $<HTMLDivElement>('hist');

interface Table { shape: Shape; goal: number; dist: Uint16Array; layer: number[]; ms: number }

let shape: Shape = { pegs: 4, disks: 8 };
let goal = 3;
let cur = 0;
let history: number[] = [];
let lifted: number | null = null;
let table: Table | null = null;
let solving: number | null = null;
let request = 0;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

function diskColor(k: number, n: number): string {
  const t = n === 1 ? 0 : k / (n - 1);
  return `hsl(${200 - 190 * t} 70% ${62 - 8 * t}%)`;
}

// ------------------------------------------------------------------ search

function load(next: Shape, nextGoal: number, start: number | null): Promise<void> {
  shape = next;
  goal = nextGoal;
  cur = start ?? perfect(shape, 0);
  history = [];
  lifted = null;
  table = null;
  stopSolve();
  render();
  const id = ++request;
  statusEl.innerHTML = `searching all <strong>${fmt(stateCount(shape))}</strong> positions…`;
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<{ id: number; dist: Uint16Array; layer: number[]; ms: number }>) => {
      if (e.data.id !== id) return;
      table = { shape, goal, dist: e.data.dist, layer: e.data.layer, ms: e.data.ms };
      statusEl.innerHTML = `searched <strong>${fmt(stateCount(shape))}</strong> positions in ${Math.round(e.data.ms)} ms`;
      render();
      resolve();
    };
    worker.postMessage({ shape, goal, id });
  });
}

const dist = (s: number) => (table ? table.dist[s] : UNSEEN);
const maxDist = () => (table ? table.layer.length - 1 : 0);

// ------------------------------------------------------------------ rendering

function render() {
  $('subStates').textContent = `all ${fmt(stateCount(shape))} positions`;
  board.style.gridTemplateColumns = `repeat(${shape.pegs}, minmax(0, 1fr))`;
  const pegOf = decode(shape, cur);
  const legal = lifted === null ? [] : moves(shape, cur).filter((m) => m.from === lifted);
  const here = dist(cur);
  board.innerHTML = '';
  const width = (k: number) => 26 + (70 * (k + 1)) / shape.disks;
  for (let p = 0; p < shape.pegs; p++) {
    const peg = document.createElement('div');
    peg.className = 'peg' + (p === goal ? ' goal' : '');
    peg.dataset.peg = String(p);
    for (let k = shape.disks - 1; k >= 0; k--) {
      if (pegOf[k] !== p) continue;
      const d = document.createElement('div');
      d.className = 'disk';
      d.style.width = `${width(k)}%`;
      d.style.background = diskColor(k, shape.disks);
      d.title = `disk ${k + 1}`;
      peg.appendChild(d);
    }
    if (lifted === p) (peg.lastElementChild as HTMLElement | null)?.classList.add('lifted');
    const m = legal.find((x) => x.to === p);
    if (m && table) {
      const b = document.createElement('div');
      const after = dist(m.next);
      b.className = 'drop ' + (after < here ? 'best' : after > here ? 'worse' : '');
      b.textContent = `→ ${after}`;
      peg.appendChild(b);
    }
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = p === goal ? `peg ${p + 1} · goal` : `peg ${p + 1}`;
    peg.appendChild(label);
    board.appendChild(peg);
  }
  renderDist();
  renderHist();
  ($('undo') as HTMLButtonElement).disabled = !history.length;
}

function renderDist() {
  if (!table) {
    distEl.innerHTML = '<div class="big">…</div><p>searching</p>';
    return;
  }
  const d = dist(cur);
  const fs = frameStewart(shape.disks, shape.pegs);
  const far = maxDist();
  const farCount = table.layer[far];
  const note = far > fs
    ? `<strong>More than the ${fs} moves a full tower needs.</strong>`
    : far === fs ? 'the same as moving a full tower across' : '';
  distEl.innerHTML = `<div class="big">${d}<small>${d === 1 ? 'move' : 'moves'}</small></div>
    <p>${history.length} made so far. A full tower needs ${fs} (Frame–Stewart${shape.pegs === 3 ? ', 2<sup>n</sup> − 1' : ''}).
    The farthest positions are ${far} moves from the goal (${fmt(farCount)} of them) — ${note}</p>`;
}

function renderHist() {
  if (!table) { histEl.innerHTML = ''; return; }
  const L = table.layer;
  const W = 300;
  const H = 120;
  const max = Math.max(...L);
  const bw = W / L.length;
  const d = dist(cur);
  const bars = L.map((c, i) => {
    const h = Math.max(c ? 1.5 : 0, (c / max) * (H - 4));
    const fill = i === d ? 'var(--mark)' : i === L.length - 1 ? 'var(--bad)' : 'var(--accent)';
    return `<rect x="${(i * bw).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${Math.max(bw - 0.6, 0.6).toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}"><title>${i} moves: ${fmt(c)} positions</title></rect>`;
  }).join('');
  histEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="number of positions at each distance">${bars}</svg>
    <p>${fmt(stateCount(shape))} positions by distance to the goal, 0 to ${L.length - 1}. Yellow: where you are.
    The widest layer (${L.indexOf(max)} moves) holds ${fmt(max)}.</p>`;
}

// ------------------------------------------------------------------ interaction

function play(m: Move, record = true) {
  if (record) history.push(cur);
  cur = m.next;
  lifted = null;
  render();
  if (cur === perfect(shape, goal) && table) {
    statusEl.innerHTML = `<strong>Done</strong> in ${history.length} moves.`;
  }
}

board.addEventListener('click', (e) => {
  const pegEl = (e.target as HTMLElement).closest<HTMLElement>('.peg');
  if (!pegEl || solving !== null) return;
  const p = Number(pegEl.dataset.peg);
  const pegOf = decode(shape, cur);
  if (lifted === null) {
    if (pegOf.includes(p)) lifted = p;
  } else if (lifted === p) {
    lifted = null;
  } else {
    const m = moves(shape, cur).find((x) => x.from === lifted && x.to === p);
    if (m) { play(m); return; }
    lifted = pegOf.includes(p) ? p : null;
  }
  render();
});

function bestMove(): Move | null {
  if (!table || dist(cur) === 0) return null;
  const d = dist(cur);
  return moves(shape, cur).find((m) => dist(m.next) === d - 1) ?? null;
}

function stopSolve() {
  if (solving !== null) clearInterval(solving);
  solving = null;
}

$('hint').addEventListener('click', () => {
  const m = bestMove();
  if (m) play(m);
});
$('solve').addEventListener('click', () => {
  if (solving !== null) { stopSolve(); return; }
  if (!table) return;
  const steps = dist(cur);
  const delay = Math.max(15, Math.min(260, 6000 / Math.max(steps, 1)));
  solving = window.setInterval(() => {
    const m = bestMove();
    if (!m) { stopSolve(); return; }
    play(m);
  }, delay);
});
$('undo').addEventListener('click', () => {
  stopSolve();
  const prev = history.pop();
  if (prev !== undefined) { cur = prev; lifted = null; render(); }
});
$('reset').addEventListener('click', () => {
  stopSolve();
  history = [];
  lifted = null;
  cur = perfect(shape, goal === 0 ? shape.pegs - 1 : 0);
  render();
});
$('random').addEventListener('click', () => {
  stopSolve();
  history = [];
  lifted = null;
  cur = Math.floor(Math.random() * stateCount(shape));
  render();
});
$('farthest').addEventListener('click', () => {
  if (!table) return;
  stopSolve();
  const far = maxDist();
  const all: number[] = [];
  table.dist.forEach((d, s) => { if (d === far) all.push(s); });
  history = [];
  lifted = null;
  cur = all[Math.floor(Math.random() * all.length)];
  render();
  statusEl.innerHTML = `one of the <strong>${fmt(all.length)}</strong> positions ${far} moves from the goal`;
});

function fillSelectors() {
  const pegs = Number(pegsSel.value);
  const keep = Number(disksSel.value) || shape.disks;
  disksSel.innerHTML = '';
  for (let n = 1; n <= MAX_DISKS[pegs]; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `${n}${n > 10 ? ' (slower)' : ''}`;
    disksSel.appendChild(o);
  }
  disksSel.value = String(Math.min(keep, MAX_DISKS[pegs]));
  const g = Number(goalSel.value);
  goalSel.innerHTML = '';
  for (let p = 0; p < pegs; p++) {
    const o = document.createElement('option');
    o.value = String(p);
    o.textContent = `peg ${p + 1}`;
    goalSel.appendChild(o);
  }
  goalSel.value = String(Number.isInteger(g) && g > 0 && g < pegs ? g : pegs - 1);
}
const reload = () => load({ pegs: Number(pegsSel.value), disks: Number(disksSel.value) }, Number(goalSel.value), null);
pegsSel.addEventListener('change', () => { goalSel.value = ''; fillSelectors(); reload(); });
disksSel.addEventListener('change', reload);
goalSel.addEventListener('change', () => load(shape, Number(goalSel.value), cur));

// ------------------------------------------------------------------ notes

function miniBoard(digits: string, pegs: number): string {
  const n = digits.length;
  let html = '<div class="mini">';
  for (let p = 0; p < pegs; p++) {
    html += `<div class="peg${p === 0 ? ' goal' : ''}">`;
    for (let k = n - 1; k >= 0; k--) {
      if (Number(digits[k]) !== p) continue;
      html += `<div class="disk" style="width:${20 + (76 * (k + 1)) / n}%;background:${diskColor(k, n)}" title="disk ${k + 1}"></div>`;
    }
    html += `<div class="label">peg ${p + 1}${p === 0 ? ' · start' : ''}</div></div>`;
  }
  return html + '</div>';
}

/** "A S B C" style description of the top-four patterns (canonical digits, smallest first). */
function patternText(patterns: Record<string, number>): string {
  const name = ['start', 'A', 'B', 'C'];
  return Object.entries(patterns).map(([p, c]) => `${[...p].map((d) => name[Number(d)]).join(' · ')} (${c} groups)`).join(', ');
}

function nearText(hist: Record<string, number>, tower: number): string {
  return Object.entries(hist).sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, c]) => `${c} have their other disks <strong>${d}</strong> moves from those two (${Number(d) - tower} more than a tower)`)
    .join(', ');
}

function renderNotes() {
  const k = stats.korf;
  const rows = k.rows.map((r) => `<tr class="${r.radius > r.optimal ? 'hot' : ''}">
    <td>${r.disks}</td><td>${r.optimal}</td><td>${r.radius}</td><td>${fmt(r.farthest)}</td><td>${fmt(r.beyond)}</td>
    <td>${fmt(r.width)}</td><td class="${r.table2 ? 'ok' : 'bad'}">${r.table2 ? '✓' : '✗'}</td>
    <td>${fmt(r.halfStates)} / ${fmt(r.halfWidth)}</td><td class="${r.table3 ? 'ok' : 'bad'}">${r.table3 ? '✓' : '✗'}</td></tr>`).join('');
  const checks = stats.checks.map((c) => `<tr><td class="l">${c.id}</td><td class="l claim">${c.claim}<br><small>${c.source}</small></td>
    <td>${c.published}</td><td>${c.computed}</td><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'}</td></tr>`).join('');
  const sp = k.split as null | {
    statesWithBigDiskAway: number; loose: number; nearestGatewayToHome: number; perfect: { exact: number };
    nearestGateways: number; nearHist: Record<string, number>; analysed: number; exact: number[];
    examples: { state: string; splits: string[] }[];
  };
  $('notes').innerHTML = `
    <h2>Korf's anomaly: 588 positions that are 130 moves away</h2>
    <p>With three pegs nothing is farther from a full tower than the full tower on another peg: 2<sup>n</sup> − 1
    moves. With four pegs, Richard Korf's complete searches (AAAI 2004) found the radius equal to the tower's move count
    for almost every size — except that with <strong>15 disks</strong> the tower moves across in <strong>129</strong> moves, yet
    <strong>588 positions are 130 moves</strong> from it. He wrote: <em>“${stats.korfQuote}”</em></p>
    <p>The table is recomputed here by <code>tools/radius.c</code>, a two-bit breadth-first search over all
    4<sup>n</sup> positions (4<sup>17</sup> ≈ 17.2 billion, 4 GiB of bits). “Farthest” counts the positions at the
    radius, “beyond” those farther than the Frame–Stewart number. Table 2 of the paper lists the radius and the widest
    layer; Table 3 lists states up to half the solution depth, one per relabelling of the three free pegs.</p>
    <table><thead><tr><th>disks</th><th>tower moves</th><th>radius</th><th>farthest</th><th>beyond</th><th>widest layer</th>
    <th>Table 2</th><th>half-depth states / width</th><th>Table 3</th></tr></thead><tbody>${rows}</tbody></table>
    <p>Rows 18–20 of Table 2 and the 21- and 22-disk searches of Korf &amp; Felner (2007: radius 341 and 395) need
    tens of gigabytes to terabytes and are quoted, not recomputed. The only cell that does not reproduce is Table 3's
    1-disk row: its rule, “states up to half the optimal solution depth, rounded up”, gives 2 there, the paper prints 1.</p>
    <h2>What the 588 look like</h2>
    <p>They come in <strong>${k.anomaly15.orbits}</strong> groups of six (the three free pegs can be relabelled), and in
    every one the <strong>largest disk is off the start peg</strong>. Where the four largest disks sit, largest first,
    with A the free peg holding the largest: ${patternText(k.patterns15)}. Here is one:</p>
    ${miniBoard(k.farthest15[0], 4)}
    ${sp ? `<p>Every route home has to put the largest disk on the start peg, and at that moment the other 14 disks must all
    sit on the two remaining pegs — a “gateway”, one of 2<sup>14</sup>. ${sp.loose === 0 ? `For all
    ${fmt(sp.statesWithBigDiskAway)} positions with the largest disk on a given free peg, some shortest route moves it
    exactly once, so each distance is the minimum over gateways of <em>(moves to the gateway) + 1 + (moves from it
    home)</em>.` : ''} Only ${sp.nearestGateways} gateways are ${sp.nearestGatewayToHome} moves from home, and a full tower on a free peg reaches one in
    ${sp.nearestGatewayToHome}: ${sp.nearestGatewayToHome} + 1 + ${sp.nearestGatewayToHome} = ${sp.perfect.exact}.
    Of the ${sp.analysed} farthest positions with the largest disk on that peg, ${nearText(sp.nearHist, sp.nearestGatewayToHome)};
    and no gateway farther from home is cheaper overall, so they land on ${sp.exact.join(', ')}.
    ${sp.examples.length ? `For <code>${sp.examples[0].state}</code> (peg of each disk, smallest first) the minimum
    ${sp.exact[0] - 1} + 1 is attained by the splits ${sp.examples[0].splits.map((x) => x.replace(/\(x\d+\)/, '')).join(', ')}.` : ''}</p>`
    : '<p>The split analysis is still being computed.</p>'}
    <h2>Every published value, recomputed</h2>
    <p><strong>${stats.summary.ok} of ${stats.summary.total}</strong> values reproduce. Published numbers are pulled by
    <code>tools/fetch-literature.mts</code> from Wikipedia (en, ja), OEIS and the two papers — none is typed by hand.
    Besides Table 3's 1-disk row, one does not: the Japanese Wikipedia gives the bit formula for the <em>m</em>-th move
    (<code>(m&amp;(m-1))%3</code> → <code>((m|(m-1))+1)%3</code>) for moving the tower to the right-hand peg,
    but played on a board it ends on the <strong>middle</strong> peg whenever the number of disks is even. The English
    article adds that pegs 1 and 2 swap for even <em>n</em>; the Japanese one does not.</p>
    <table class="checks"><thead><tr><th class="l">id</th><th class="l">claim</th><th>published</th><th>computed</th><th></th></tr></thead>
    <tbody>${checks}</tbody></table>`;
}

// ------------------------------------------------------------------ start

const params = new URLSearchParams(location.search);
const qp = Number(params.get('pegs'));
if ([3, 4, 5].includes(qp)) pegsSel.value = String(qp);
fillSelectors();
const qd = Number(params.get('disks'));
if (qd >= 1 && qd <= MAX_DISKS[Number(pegsSel.value)]) disksSel.value = String(qd);
const qg = params.get('goal');
if (qg !== null && Number(qg) >= 0 && Number(qg) < Number(pegsSel.value)) goalSel.value = qg;
const start: Shape = { pegs: Number(pegsSel.value), disks: Number(disksSel.value) };
const qs = params.get('state');
const startState = qs && qs.length === start.disks && [...qs].every((c) => Number(c) < start.pegs)
  ? encode(start, [...qs].map(Number)) : null;
renderNotes();
load(start, Number(goalSel.value), startState).then(() => {
  const lift = params.get('lift');
  if (lift !== null && decode(shape, cur).includes(Number(lift))) { lifted = Number(lift); render(); }
});
