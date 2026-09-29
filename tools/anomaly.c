// Why are 588 states of the 15-disk, 4-peg puzzle 130 moves from the start when the
// standard problem needs only 129? This takes every farthest state (from radius.c's dump)
// and splits its distance at the move of the largest disk.
//
//   cc -O3 -o /tmp/anomaly tools/anomaly.c -lpthread
//   /tmp/anomaly <disks> <far-file> [threads]
//
// With D the largest disk and n-1 = m the rest: for a state s with D on peg 1, any path
// back to "all on peg 0" must at some point move D onto peg 0, and at that moment the
// other m disks sit on pegs 2 and 3 only (a "gateway"). If D moves exactly once,
//     d(s) = min over gateways g of  d_m(s', g) + 1 + d_m(g, home)
// where d_m is distance in the m-disk puzzle (D never blocks anything). The tool computes
// that bound for every state with D on peg 1, compares it with the exact distance, and for
// each farthest state prints the bound and its distance to the gateways nearest to home;
// for a few of them also every (before, after) split that attains the bound.

#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int THREADS = 16;

typedef struct {
  int n;
  uint64_t states;
  uint8_t *d;   // 255 = unassigned
  int level;
  volatile uint64_t next;
} Search;

static void expandAll(Search *S, uint64_t s) {
  int n = S->n, top[4] = {-1, -1, -1, -1};
  for (int k = n - 1; k >= 0; k--) top[(s >> (2 * k)) & 3] = k;
  uint8_t want = 255, put = (uint8_t)(S->level + 1);
  for (int a = 0; a < 4; a++) {
    if (top[a] < 0) continue;
    for (int b = 0; b < 4; b++) {
      if (b == a || (top[b] >= 0 && top[b] < top[a])) continue;
      uint64_t u = s + (((uint64_t)b - (uint64_t)a) << (2 * top[a]));
      if (S->d[u] != 255) continue;
      uint8_t expect = want;
      __atomic_compare_exchange_n(&S->d[u], &expect, put, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED);
    }
  }
}

static void *levelWorker(void *arg) {
  Search *S = arg;
  const uint64_t CH = 1 << 20;
  uint8_t L = (uint8_t)S->level;
  for (;;) {
    uint64_t lo = __atomic_fetch_add(&S->next, CH, __ATOMIC_RELAXED);
    if (lo >= S->states) break;
    uint64_t hi = lo + CH < S->states ? lo + CH : S->states;
    for (uint64_t s = lo; s < hi; s++)
      if (S->d[s] == L) expandAll(S, s);
  }
  return NULL;
}

static uint64_t countLevel(Search *S, uint8_t L) {
  uint64_t c = 0;
  for (uint64_t s = 0; s < S->states; s++) c += S->d[s] == L;
  return c;
}

// Multi-source BFS: source i enters at level offset[i]. offset == NULL means all at 0.
static void search(Search *S, const uint64_t *src, const uint8_t *offset, uint64_t nsrc) {
  memset(S->d, 255, S->states);
  int maxOffset = 0;
  for (uint64_t i = 0; i < nsrc; i++) if (offset && offset[i] > maxOffset) maxOffset = offset[i];
  for (S->level = 0; S->level < 254; S->level++) {
    for (uint64_t i = 0; i < nsrc; i++)
      if ((offset ? offset[i] : 0) == S->level && S->d[src[i]] == 255) S->d[src[i]] = (uint8_t)S->level;
    pthread_t th[64];
    S->next = 0;
    for (int t = 0; t < THREADS; t++) pthread_create(&th[t], NULL, levelWorker, S);
    for (int t = 0; t < THREADS; t++) pthread_join(th[t], NULL);
    if (S->level >= maxOffset && countLevel(S, (uint8_t)(S->level + 1)) == 0) break;
  }
}

static uint64_t parse(const char *line, int n) {  // digits smallest disk first
  uint64_t s = 0;
  for (int k = 0; k < n; k++) s |= (uint64_t)(line[k] - '0') << (2 * k);
  return s;
}

static void print(uint64_t s, int n) {
  for (int k = 0; k < n; k++) putchar('0' + (int)((s >> (2 * k)) & 3));
}

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: anomaly <disks> <far-file> [threads]\n"); return 2; }
  int n = atoi(argv[1]), m = n - 1;
  if (argc > 3) THREADS = atoi(argv[3]);
  uint64_t Sm = 1ULL << (2 * m), Sn = 1ULL << (2 * n);

  // exact distances to home in the full puzzle
  Search full = {n, Sn, malloc(Sn), 0, 0};
  uint64_t home = 0;
  search(&full, &home, NULL, 1);

  // m-disk distances to home
  Search small = {m, Sm, malloc(Sm), 0, 0};
  search(&small, &home, NULL, 1);
  uint8_t *toHome = small.d;

  // gateways: every m-disk state on pegs 2 and 3 only
  uint64_t ng = 1ULL << m, *gate = malloc(ng * sizeof *gate);
  uint8_t *gateOff = malloc(ng);
  for (uint64_t i = 0; i < ng; i++) {
    uint64_t s = 0;
    for (int k = 0; k < m; k++) s |= (uint64_t)(2 + ((i >> k) & 1)) << (2 * k);
    gate[i] = s;
    gateOff[i] = toHome[s];
  }
  int bestGate = 255;
  for (uint64_t i = 0; i < ng; i++) if (gateOff[i] < bestGate) bestGate = gateOff[i];
  printf("gateways %llu nearest-to-home %d\n", (unsigned long long)ng, bestGate);

  // once[x] = min over gateways of d(x, g) + d(g, home)
  Search once = {m, Sm, malloc(Sm), 0, 0};
  search(&once, gate, gateOff, ng);

  // compare the "largest disk moves once" bound with the exact distance
  uint64_t equal = 0, strict = 0, hist[8] = {0};
  for (uint64_t x = 0; x < Sm; x++) {
    int exact = full.d[x + Sm];  // disk D on peg 1
    int bound = once.d[x] + 1;
    if (bound == exact) equal++;
    else { strict++; if (bound - exact < 8) hist[bound - exact]++; }
  }
  printf("D-on-peg-1 states %llu bound-tight %llu bound-loose %llu\n",
         (unsigned long long)Sm, (unsigned long long)equal, (unsigned long long)strict);
  for (int k = 1; k < 8; k++) if (hist[k]) printf("  loose-by %d: %llu\n", k, (unsigned long long)hist[k]);

  // distance of every m-disk state to the nearest of the gateways closest to home
  uint64_t nn = 0, *nearGate = malloc(ng * sizeof *nearGate);
  for (uint64_t i = 0; i < ng; i++) if (gateOff[i] == bestGate) nearGate[nn++] = gate[i];
  Search near = {m, Sm, malloc(Sm), 0, 0};
  search(&near, nearGate, NULL, nn);
  printf("nearest gateways %llu\n", (unsigned long long)nn);

  // every farthest state with D on peg 1: exact distance, the once-bound, and how far its
  // smaller disks are from the nearest gateways. For the first few with the first free
  // disk below D on peg 2, also list every (before, after) split attaining the bound.
  FILE *f = fopen(argv[2], "r");
  if (!f) { perror("fopen"); return 1; }
  char line[64];
  Search from = {m, Sm, malloc(Sm), 0, 0};
  int nf = 0, detailed = 0;
  while (fgets(line, sizeof line, f)) {
    uint64_t s = parse(line, n);
    if (((s >> (2 * m)) & 3) != 1) continue;
    uint64_t x = s & (Sm - 1);
    printf("far ");
    print(s, n);
    printf(" exact %d once %d near %d", full.d[s], once.d[x] + 1, near.d[x]);
    int first = 0;
    for (int k = m - 1; k >= 0 && !first; k--) {
      int p = (s >> (2 * k)) & 3;
      if (p >= 2) first = p;
    }
    if (first == 2 && detailed < 4) {
      detailed++;
      search(&from, &x, NULL, 1);
      int best = 255;
      for (uint64_t i = 0; i < ng; i++) {
        int v = from.d[gate[i]] + gateOff[i];
        if (v < best) best = v;
      }
      int splits[256] = {0};
      for (uint64_t i = 0; i < ng; i++)
        if (from.d[gate[i]] + gateOff[i] == best) splits[from.d[gate[i]]]++;
      printf(" splits");
      for (int a = 0; a < 256; a++) if (splits[a]) printf(" %d+1+%d(x%d)", a, best - a, splits[a]);
    }
    printf("\n");
    fflush(stdout);
    nf++;
  }
  printf("analysed %d\n", nf);

  // the standard problem for comparison: all disks on peg 1
  uint64_t x = 0x5555555555555555ULL & (Sm - 1);
  search(&from, &x, NULL, 1);
  int best = 255;
  for (uint64_t i = 0; i < ng; i++) {
    int v = from.d[gate[i]] + gateOff[i];
    if (v < best) best = v;
  }
  printf("perfect exact %d once %d\n", full.d[x + Sm], best + 1);
  return 0;
}
