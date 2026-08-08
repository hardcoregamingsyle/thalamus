import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [vlyPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": `${__dirname}src`,
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Only packages that are actually installed may appear here — Rollup
        // fails the build on an entry it cannot resolve.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router'],
          'convex-vendor': ['convex'],
          'radix-ui': [
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-dialog',
            '@radix-ui/react-label',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
          ],
          'framer-motion': ['framer-motion'],
          'three': ['three', '@react-three/fiber'],
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 1000,
    target: 'esnext',
    minify: 'esbuild',
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router',
      // Only reached from a lazily-imported route, so Vite does not see it at
      // startup — it discovers it mid-session, re-runs the optimizer, and every
      // dep's ?v= hash changes. Its own fix for that is to reload the page,
      // which hmr:false below switches off, so the tab is left holding half the
      // old chunks and half the new ones. That is two copies of React in one
      // tree: "Invalid hook call" and a blank error screen on a cold start,
      // with nothing in the message pointing here. Pre-bundling it at startup
      // is the whole fix.
      '@vly-ai/integrations',
    ],
    exclude: ['three', '@react-three/fiber'],
  },
  server: {
    hmr: false,
  },
});