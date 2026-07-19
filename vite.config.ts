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
        // 在线 App：不预缓存静态资源
        globPatterns: [],
        // 必须关闭：createHandlerBoundToURL('index.html') 要求 index 在 precache 里，
        // globPatterns 为空时会抛 non-precached-url，整页 SW 初始化失败
        navigateFallback: null,
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
            const norm = id.replace(/\\/g, '/');
            // 仅动态 import 的重库：返回 undefined，由 Rollup 打成 async chunk，
            // 避免并进常驻 vendor + modulepreload 首屏拉取。
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
            // 大块 UI 库单独拆，减少主 vendor 解析量
            if (norm.includes('framer-motion')) return 'vendor-framer-motion';
            if (norm.includes('lucide-react')) return 'vendor-lucide';
            // React 与依赖它的运行时（zustand/hot-toast/…）必须同 chunk。
            // 单独拆 vendor-react 会与 vendor 形成循环依赖（interop 助手 / zustand/react），
            // 运行时 React 为 undefined → reading 'memo' 白屏。
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
