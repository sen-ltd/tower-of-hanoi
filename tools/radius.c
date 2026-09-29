// Complete breadth-first search of the 4-peg Tower of Hanoi from "all disks on peg 0",
// two bits per state (Korf's two-bit BFS), multithreaded. This is the offline half of
// the project: the browser does the same search in TypeScript up to 12 disks, this
// does it up to 17 (4^17 states = 4 GiB of bits).
//
//   cc -O3 -o /tmp/radius tools/radius.c -lpthread
//   /tmp/radius <disks> [threads] [dump-file]
//
// Output, one line per depth:  depth <d> <states> <canonical>
// followed by summary lines (radius, width, goal depth). "canonical" counts states whose
// non-initial pegs are sorted by their bottom disk, i.e. one state per orbit of the six
// relabelings of pegs 1..3 (Korf 2004 counts those). If a dump file is given, every state
// at the last depth is written there, one per line, as a string of peg digits
// (disk 1 = smallest first).

#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// cell values: 0 unvisited, 1 frontier (depth d), 2 next (depth d+1), 3 closed
static int N;                 // disks
static uint64_t STATES;       // 4^N
static uint64_t WORDS;        // 32 cells per word
static uint64_t *A;
static int NTHREADS = 8;
static uint64_t GOAL;         // all disks on peg 1
static long long goalDepth = -1;
static int depth;
static volatile uint64_t nextChunk;
static const uint64_t CHUNK = 1 << 14;

typedef struct { uint64_t fresh, canon, frontier; } Tally;

static inline int get(uint64_t s) { return (A[s >> 5] >> ((s & 31) * 2)) & 3; }

static void expand(uint64_t s, Tally *t) {
  int top[4] = {-1, -1, -1, -1}, bottom[4] = {-1, -1, -1, -1};
  for (int d = 0; d < N; d++) {
    int p = (s >> (2 * d)) & 3;
    if (top[p] < 0) top[p] = d;
    bottom[p] = d;
  }
  t->frontier++;
  if (bottom[1] <= bottom[2] && bottom[2] <= bottom[3]) t->canon++;
  for (int a = 0; a < 4; a++) {
    if (top[a] < 0) continue;
    for (int b = 0; b < 4; b++) {
      if (b == a || (top[b] >= 0 && top[b] < top[a])) continue;
      uint64_t u = s + (((uint64_t)b - (uint64_t)a) << (2 * top[a]));
      int sh = (u & 31) * 2;
      if (((A[u >> 5] >> sh) & 3) != 0) continue;
      uint64_t old = __atomic_fetch_or(&A[u >> 5], 2ULL << sh, __ATOMIC_RELAXED);
      if (((old >> sh) & 3) == 0) {
        t->fresh++;
        if (u == GOAL) goalDepth = depth + 1;
      }
    }
  }
}

static Tally totals[64];

static void *worker(void *arg) {
  Tally *t = &totals[(intptr_t)arg];
  memset(t, 0, sizeof *t);
  for (;;) {
    uint64_t lo = __atomic_fetch_add(&nextChunk, CHUNK, __ATOMIC_RELAXED);
    if (lo >= WORDS) break;
    uint64_t hi = lo + CHUNK < WORDS ? lo + CHUNK : WORDS;
    for (uint64_t w = lo; w < hi; w++) {
      uint64_t x = A[w];
      uint64_t l = x & 0x5555555555555555ULL, h = (x >> 1) & 0x5555555555555555ULL;
      uint64_t m = l & ~h;  // cells == 1
      while (m) {
        int bit = __builtin_ctzll(m);
        m &= m - 1;
        uint64_t s = (w << 5) | (bit >> 1);
        if (s < STATES) expand(s, t);
      }
    }
  }
  return NULL;
}

// frontier (1) -> closed (3), next (2) -> frontier (1)
static void *promote(void *arg) {
  (void)arg;
  for (;;) {
    uint64_t lo = __atomic_fetch_add(&nextChunk, CHUNK, __ATOMIC_RELAXED);
    if (lo >= WORDS) break;
    uint64_t hi = lo + CHUNK < WORDS ? lo + CHUNK : WORDS;
    for (uint64_t w = lo; w < hi; w++) {
      uint64_t x = A[w];
      uint64_t l = x & 0x5555555555555555ULL, h = (x >> 1) & 0x5555555555555555ULL;
      A[w] = (l | h) | (l << 1);
    }
  }
  return NULL;
}

static void run(void *(*fn)(void *)) {
  pthread_t th[64];
  nextChunk = 0;
  for (intptr_t i = 0; i < NTHREADS; i++) pthread_create(&th[i], NULL, fn, (void *)i);
  for (int i = 0; i < NTHREADS; i++) pthread_join(th[i], NULL);
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: radius <disks> [threads] [dump-file]\n"); return 2; }
  N = atoi(argv[1]);
  if (argc > 2) NTHREADS = atoi(argv[2]);
  if (N < 1 || N > 18 || NTHREADS < 1 || NTHREADS > 64) { fprintf(stderr, "bad arguments\n"); return 2; }
  STATES = 1ULL << (2 * N);
  WORDS = (STATES + 31) / 32;
  A = calloc(WORDS, sizeof *A);
  if (!A) { perror("calloc"); return 1; }
  GOAL = 0x5555555555555555ULL & (STATES - 1);

  A[0] = 1;  // all disks on peg 0
  uint64_t reached = 1, width = 1, lastCount = 1;
  printf("disks %d states %llu\n", N, (unsigned long long)STATES);
  for (depth = 0;; depth++) {
    run(worker);
    Tally sum = {0, 0, 0};
    for (int i = 0; i < NTHREADS; i++) {
      sum.fresh += totals[i].fresh; sum.canon += totals[i].canon; sum.frontier += totals[i].frontier;
    }
    printf("depth %d %llu %llu\n", depth, (unsigned long long)sum.frontier, (unsigned long long)sum.canon);
    fflush(stdout);
    lastCount = sum.frontier;
    if (sum.frontier > width) width = sum.frontier;
    if (sum.fresh == 0) break;
    reached += sum.fresh;
    run(promote);
  }
  printf("radius %d\nlast %llu\nwidth %llu\nreached %llu\ngoal %lld\n", depth,
         (unsigned long long)lastCount, (unsigned long long)width,
         (unsigned long long)reached, goalDepth);

  if (argc > 3) {
    FILE *f = fopen(argv[3], "w");
    if (!f) { perror("fopen"); return 1; }
    for (uint64_t s = 0; s < STATES; s++) {
      if (get(s) != 1) continue;  // the last frontier was never promoted
      for (int d = 0; d < N; d++) fputc('0' + (int)((s >> (2 * d)) & 3), f);
      fputc('\n', f);
    }
    fclose(f);
  }
  return reached == STATES ? 0 : 1;
}
