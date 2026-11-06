import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // la web usa el código fuente del paquete compartido (ESM), la API su build (CommonJS)
      '@minitta/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // librerías base aparte: cambian poco y el navegador las mantiene en caché
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          ui: ['radix-ui', 'lucide-react', 'sonner'],
          data: ['@tanstack/react-query', 'zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/uploads': 'http://127.0.0.1:3000',
    },
  },
});
