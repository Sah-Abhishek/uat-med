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
      'uat-med.icdcore.com', 'uat.nxtcodeai.com',
      '216.48.183.225',
      'localhost',
    ],
    proxy: {
      '/api/v1': {
        target: 'http://localhost:2500',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: true,
    port: 8700,
    allowedHosts: [
      'prod.nxtcodeai.com',
      'prod-med.icdcore.com',
      'nxtcodeai.com',
      '216.48.183.225',
      '91.203.132.241',
      'localhost',
    ],
    proxy: {
      '/api/v1': {
        target: 'http://localhost:2600',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
