// Runs the full breadth-first search off the main thread; the distance table comes back
// as a transferred buffer.
import { bfs, perfect, type Shape } from './hanoi.ts';

self.onmessage = (e: MessageEvent<{ shape: Shape; goal: number; id: number }>) => {
  const { shape, goal, id } = e.data;
  const t0 = performance.now();
  const search = bfs(shape, perfect(shape, goal));
  const ms = performance.now() - t0;
  (self as unknown as Worker).postMessage({ id, dist: search.dist, layer: search.layer, ms }, [search.dist.buffer]);
};
