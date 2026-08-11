import path from "path"
import { readFileSync } from "fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-info'

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
) as { version: string }

// 部署到 Cloudflare Pages，使用根路径
// 不注册 Service Worker：应用强依赖在线 API，SW 无离线收益且曾导致缓存/白屏问题。
// 安装元数据用 public/manifest.webmanifest + index.html 静态 link。
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
  ],
  /**
   * localforage 预构建避免冷启动 reload。
   */
  optimizeDeps: {
    include: ['localforage'],
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    warmup: {
      clientFiles: [
        './src/services/filesService.ts',
      ],
    },
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
    // 与 package.json version 同步，UI 左上角等处使用
    __APP_VERSION__: JSON.stringify(pkg.version),
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
              norm.includes('sentence-splitter')
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
