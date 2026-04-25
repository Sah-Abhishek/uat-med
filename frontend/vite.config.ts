import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 8600,
    allowedHosts: [
      'uat-med.icdcore.com', 
      '216.48.183.225', 
      'localhost',
    ],
    proxy: {
      '/api/v1': {
        target: 'https://apiuatnextcode.icdcore.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});