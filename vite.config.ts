import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // pdfmake and its fonts are large but only load when exporting.
  build: { chunkSizeWarningLimit: 1000 },
});
