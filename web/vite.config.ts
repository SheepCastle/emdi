import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mermaid') || id.includes('node_modules/cytoscape') || id.includes('node_modules/katex') || id.includes('node_modules/dagre')) {
            return 'mermaid-vendor';
          }
        },
      },
    },
  },
});
