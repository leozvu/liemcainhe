import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Plugin viết bằng .mjs để chạy được ở Node thuần, không cần bước biên dịch trước.
import { trendProxyPlugin } from './scripts/trend-proxy-plugin.mjs';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api-proxy/shopaikey': {
            target: 'https://api.shopaikey.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/shopaikey/, ''),
          },
          '/api-proxy/facebook': {
            target: 'https://graph.facebook.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/facebook/, ''),
          },
          '/api-proxy/threads': {
            target: 'https://graph.threads.net',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/threads/, ''),
          },
          '/api-proxy/zalo': {
            target: 'https://openapi.zalo.me',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/zalo/, ''),
          },
        },
      },
      preview: {
        port: 3005,
        host: '0.0.0.0',
        proxy: {
          '/api-proxy/shopaikey': {
            target: 'https://api.shopaikey.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/shopaikey/, ''),
          },
          '/api-proxy/facebook': {
            target: 'https://graph.facebook.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/facebook/, ''),
          },
          '/api-proxy/threads': {
            target: 'https://graph.threads.net',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/threads/, ''),
          },
          '/api-proxy/zalo': {
            target: 'https://openapi.zalo.me',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api-proxy\/zalo/, ''),
          },
        },
      },
      plugins: [react(), trendProxyPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
