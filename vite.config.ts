import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-info'
import { VitePWA } from 'vite-plugin-pwa'  // <-- NEW

const isProd = process.env.BUILD_MODE === 'prod'

// 部署到 Cloudflare Pages，使用根路径
const base = '/'

export default defineConfig({
  base: base,
  plugins: [
    react(),
    sourceIdentifierPlugin({
      enabled: !isProd,
      attributePrefix: 'data-matrix',
      includeProps: true,
    }),
    VitePWA({                              // <-- NEW
      registerType: 'autoUpdate',          // 新 SW 自动激活（= skipWaiting + clients.claim）
      injectRegister: 'auto',              // 插件自动注入注册脚本
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
        // dev 模式下不启用 SW；Task 7 手动 QA 用 pnpm preview 跑生产构建
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  optimizeDeps: {},
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
            if (id.includes('framer-motion')) return 'vendor-framer-motion';
            if (id.includes('@radix-ui')) return 'vendor-radix';
            if (id.includes('react-router')) return 'vendor-react-router';
            if (id.includes('lucide-react')) return 'vendor-lucide';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            return 'vendor';
          }
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  // 确保 public 目录下的文件使用相对路径
  publicDir: 'public'
})
