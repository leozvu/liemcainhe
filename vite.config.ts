import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api-proxy/openrouter': {
            target: 'https://openrouter.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/openrouter/, ''),
          },
          '/api-proxy/google': {
            target: 'https://generativelanguage.googleapis.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/google/, ''),
          },
          '/api-proxy/replicate': {
            target: 'https://api.replicate.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/replicate/, ''),
          },
        },
      },
      preview: {
        port: 3005,
        host: '0.0.0.0',
        proxy: {
          '/api-proxy/openrouter': {
            target: 'https://openrouter.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/openrouter/, ''),
          },
          '/api-proxy/google': {
            target: 'https://generativelanguage.googleapis.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/google/, ''),
          },
          '/api-proxy/replicate': {
            target: 'https://api.replicate.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/replicate/, ''),
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
