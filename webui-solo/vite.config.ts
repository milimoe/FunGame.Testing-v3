import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ============================================================================
// 资源路径控制 —— 目的是「**永远不用手改 index.html**」
//
// 两条路，按部署形态选一条：
//
// 1) base（默认 './'）
//    相对路径，产物丢到任意目录都能跑。应用是 hash 路由，不需要 SPA 重写。
//    适用：WebAPI 托管（/solo/）、或静态站根目录。
//
// 2) VITE_ASSET_PREFIX
//    给产物里的 assets/ URL 加一个任意前缀，**可以是相对的**。
//    例：VITE_ASSET_PREFIX=solo/  →  src="solo/assets/index-xxx.js"
//    适用：index.html 的 URL 比 assets/ 所在目录高一层时（vite 的 base 表达不了这种，
//          它只认 './' 或绝对路径，./solo/ 会被它归一化成 /）。
//
// 用法示例（Windows cmd / 宝塔构建机）：
//   set VITE_ASSET_PREFIX=solo/ && npm run build
//   VITE_ASSET_PREFIX=solo/ npm run build          # bash
// ============================================================================
const base = process.env.VITE_BASE ?? './'
const assetPrefix = process.env.VITE_ASSET_PREFIX ?? ''

function assetPrefixPlugin(prefix: string): Plugin {
  const normalized = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix
  return {
    name: 'fungame:asset-prefix',
    enforce: 'post',
    transformIndexHtml(html) {
      if (!normalized) return html
      // ./assets/ 或 /assets/ 或 assets/  →  <prefix>assets/
      return html.replace(/(["'])(?:\.\/|\/)?assets\//g, `$1${normalized}assets/`)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), assetPrefixPlugin(assetPrefix)],
  base,
  build: {
    outDir: 'dist',
    // 产物要能直接丢进 WebAPI 的 webui-solo 目录或宝塔静态站目录
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5175,
    proxy: {
      // 仅本机开发用。注意：应用内所有请求都走「baseUrl + path」的绝对地址，
      // 所以真正连哪里由界面里的 baseUrl 设置决定，这里只是兜底。
      // 生产环境前端与后端同源（nginx 反代 fun.milimoe.com），不经过此代理。
      '/api': 'http://localhost:11030',
      '/ws': {
        target: 'ws://localhost:11030',
        ws: true,
      },
    },
  },
})
