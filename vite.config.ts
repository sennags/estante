import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // The export libraries are large but only load when exporting.
  build: {
    chunkSizeWarningLimit: 1000,
    // The privacy policy and terms are plain pages next to the app.
    rollupOptions: { input: ['index.html', 'privacidade.html', 'termos.html'] },
  },
});
