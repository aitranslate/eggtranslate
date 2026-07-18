import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-info'
import { VitePWA } from 'vite-plugin-pwa'

// 部署到 Cloudflare Pages，使用根路径
export default defineConfig(({ command }) => ({
  base: '/',
  plugins: [
    react(),
    sourceIdentifierPlugin({
      // 仅 dev server 注入定位属性，任何构建产物都不携带
      enabled: command === 'serve',
      attributePrefix: 'data-matrix',
      includeProps: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: '蛋蛋字幕翻译',
        short_name: '蛋蛋字幕翻译',
        description: '音视频转录 + 字幕翻译，本地处理隐私安全',
        start_url: '/?source=pwa',
        display: 'standalone',
        theme_color: '#F3C323',
        background_color: '#ffffff',
        lang: 'zh-CN',
        orientation: 'any',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 在线 App，不预缓存任何资源
        globPatterns: [],
      },
      devOptions: {
        // dev 模式下不启用 SW；手动 QA 用 pnpm preview 跑生产构建
        enabled: false,
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Agent web_search：开发态代理 Parallel（免费无 Key），避免浏览器 CORS
    proxy: {
      '/api/parallel-mcp': {
        target: 'https://search.parallel.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/parallel-mcp$/, '/mcp'),
        secure: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api/parallel-mcp': {
        target: 'https://search.parallel.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/parallel-mcp$/, '/mcp'),
        secure: true,
      },
    },
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // 仅动态 import 的重库：不要并进常驻 vendor，否则 import() 无效、
            // 首屏 modulepreload 仍会拉整包（ASR / ZIP / 断句 / lamejs）。
            // 返回 undefined 交给 Rollup 自动拆成 async chunk。
            const norm = id.replace(/\\/g, '/');
            if (
              norm.includes('assemblyai') ||
              norm.includes('/jszip/') ||
              norm.endsWith('/jszip') ||
              norm.includes('sentence-splitter') ||
              norm.includes('@breezystack') ||
              norm.includes('lamejs')
            ) {
              return undefined;
            }
            if (norm.includes('framer-motion')) return 'vendor-framer-motion';
            if (norm.includes('lucide-react')) return 'vendor-lucide';
            // 避免把 react-hot-toast 等「含 react 子串」的包误并入 react 核
            if (
              /\/(react|react-dom)(\/|$)/.test(norm) ||
              norm.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            return 'vendor';
          }
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
}))
