import { defineConfig } from 'vite';

export default defineConfig({
  base: '/portfolio/tower-of-hanoi/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
