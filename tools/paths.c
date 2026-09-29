// Brute-force count of the simple paths ("non-self-crossing paths") between two perfect
// states of the 3-peg Hanoi graph with h disks. Wikipedia derives the counts from the
// recurrence N(h+1) = N(h)^2 + N(h)^3; this counts them by walking every path instead,
// without using the recursive structure of the graph.
//
//   cc -O3 -o /tmp/paths tools/paths.c -lpthread
//   /tmp/paths <disks> [threads]
//
// The search is split at a fixed prefix depth; each thread takes whole prefixes.

#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static int H, V;           // disks, vertices (3^H)
static int adj[81][3], deg[81];
static int target;

static void build(void) {
  V = 1;
  for (int i = 0; i < H; i++) V *= 3;
  for (int s = 0; s < V; s++) {
    int peg[8], top[3] = {-1, -1, -1}, x = s;
    for (int d = 0; d < H; d++) { peg[d] = x % 3; x /= 3; }
    for (int d = H - 1; d >= 0; d--) top[peg[d]] = d;  // smallest disk on each peg
    deg[s] = 0;
    for (int a = 0; a < 3; a++) {
      if (top[a] < 0) continue;
      for (int b = 0; b < 3; b++) {
        if (a == b || (top[b] >= 0 && top[b] < top[a])) continue;
        int p = 1;
        for (int d = 0; d < top[a]; d++) p *= 3;
        adj[s][deg[s]++] = s + (b - a) * p;
      }
    }
  }
  target = (V - 1) / 2;  // every digit 1: all disks on peg 1
}

static uint64_t dfs(int v, uint8_t *seen) {
  if (v == target) return 1;
  uint64_t n = 0;
  seen[v] = 1;
  for (int i = 0; i < deg[v]; i++)
    if (!seen[adj[v][i]]) n += dfs(adj[v][i], seen);
  seen[v] = 0;
  return n;
}

// prefixes: paths of fixed length from vertex 0 that have not reached the target
#define MAXP 200000
static int prefix[MAXP][24], prefixLen[MAXP], nPrefix;
static uint64_t direct;  // paths that reach the target within the prefix depth
static int DEPTH;

static void collect(int *path, int len, uint8_t *seen) {
  int v = path[len - 1];
  if (v == target) { direct++; return; }
  if (len == DEPTH) {
    if (nPrefix >= MAXP) { fprintf(stderr, "too many prefixes\n"); exit(1); }
    for (int i = 0; i < len; i++) prefix[nPrefix][i] = path[i];
    prefixLen[nPrefix++] = len;
    return;
  }
  seen[v] = 1;
  for (int i = 0; i < deg[v]; i++) {
    int u = adj[v][i];
    if (seen[u]) continue;
    path[len] = u;
    collect(path, len + 1, seen);
  }
  seen[v] = 0;
}

static volatile int nextPrefix;
static uint64_t partial[64];

static void *worker(void *arg) {
  intptr_t id = (intptr_t)arg;
  uint8_t seen[81];
  for (;;) {
    int k = __atomic_fetch_add(&nextPrefix, 1, __ATOMIC_RELAXED);
    if (k >= nPrefix) break;
    for (int i = 0; i < V; i++) seen[i] = 0;
    for (int i = 0; i < prefixLen[k] - 1; i++) seen[prefix[k][i]] = 1;
    partial[id] += dfs(prefix[k][prefixLen[k] - 1], seen);
  }
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: paths <disks 1..4> [threads]\n"); return 2; }
  H = atoi(argv[1]);
  int threads = argc > 2 ? atoi(argv[2]) : 8;
  if (H < 1 || H > 4 || threads < 1 || threads > 64) { fprintf(stderr, "bad arguments\n"); return 2; }
  build();
  DEPTH = H < 4 ? 2 : 20;
  int path[24] = {0};
  uint8_t seen[81] = {0};
  collect(path, 1, seen);
  pthread_t th[64];
  for (intptr_t i = 0; i < threads; i++) pthread_create(&th[i], NULL, worker, (void *)i);
  for (int i = 0; i < threads; i++) pthread_join(th[i], NULL);
  uint64_t total = direct;
  for (int i = 0; i < threads; i++) total += partial[i];
  printf("disks %d vertices %d prefixes %d paths %llu\n", H, V, nPrefix, (unsigned long long)total);
  return 0;
}
