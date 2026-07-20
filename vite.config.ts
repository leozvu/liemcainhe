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
          '/api-proxy/kie-files': {
            target: 'https://kieai.redpandaai.co',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/kie-files/, ''),
          },
          '/api-proxy/kie': {
            target: 'https://api.kie.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/kie/, ''),
          },
          '/api-proxy/fpt': {
            target: 'https://api.fpt.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/fpt/, ''),
          },
          '/api-proxy/viettel': {
            target: 'https://viettelai.vn',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/viettel/, ''),
          },
          '/api-proxy/elevenlabs': {
            target: 'https://api.elevenlabs.io',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/elevenlabs/, ''),
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
          '/api-proxy/kie-files': {
            target: 'https://kieai.redpandaai.co',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/kie-files/, ''),
          },
          '/api-proxy/kie': {
            target: 'https://api.kie.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/kie/, ''),
          },
          '/api-proxy/fpt': {
            target: 'https://api.fpt.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/fpt/, ''),
          },
          '/api-proxy/viettel': {
            target: 'https://viettelai.vn',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/viettel/, ''),
          },
          '/api-proxy/elevenlabs': {
            target: 'https://api.elevenlabs.io',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/elevenlabs/, ''),
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
