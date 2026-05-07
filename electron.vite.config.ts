/**
 * electron-vite 統一構建配置
 *
 * 負責同時配置三個進程的 Vite 構建：
 *  - main    ：Electron 主進程（Node.js 環境）
 *  - preload ：預加載腳本（沙盒橋接層，兩個入口）
 *  - renderer：渲染進程（Chromium 環境，兩個 HTML 入口）
 *
 * 輸出目錄：out/main / out/preload / out/renderer
 */
import {resolve} from 'path'
import {defineConfig, externalizeDepsPlugin} from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'

export default defineConfig({
  // ─── 主進程配置 ────────────────────────────────────────────────
  main: {
    plugins: [
      // 將所有 node_modules 依賴標記為 external（主進程直接 require，不打包進去）
      externalizeDepsPlugin()
    ],
    build: {
      rollupOptions: {
        // 主進程入口文件 → out/main/index.js
        input: resolve('electron/main/index.ts')
      }
    },
    resolve: {
      alias: {
        // 主進程內部路徑別名
        '@main': resolve('electron/main'),
        '@shared': resolve('electron/shared')
      }
    }
  },

  // ─── 預加載腳本配置 ───────────────────────────────────────────
  preload: {
    plugins: [
      // 預加載腳本同樣不打包 node_modules
      externalizeDepsPlugin()
    ],
    resolve: {
      alias: {
        '@shared': resolve('electron/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          // 主窗口預加載腳本 → out/preload/index.js
          index: resolve('electron/preload/index.ts'),
          // 浮球窗口預加載腳本 → out/preload/floatingBall.js
          floatingBall: resolve('electron/preload/floating-ball.preload.ts')
        }
      }
    }
  },

  // ─── 渲染進程配置 ────────────────────────────────────────────
  renderer: {
    // electron-vite 默認 renderer root 為 src/renderer/，
    // 本項目所有渲染源碼在 src/，顯式覆蓋以確保 HTML 入口路徑正確
    root: resolve('src'),
    resolve: {
      alias: {
        // @ 指向 src 目錄，所有渲染進程代碼通用
        '@': resolve('src'),
        // @shared 指向 electron/shared 目錄，讓渲染進程直接引用主進程的 IPC 頻道常量，
        // 避免維護兩份手動同步的副本
        '@shared': resolve('electron/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          // 主窗口 HTML 入口 → out/renderer/index.html
          index: resolve('src/index.html'),
          // 浮球窗口 HTML 入口 → out/renderer/floating-ball.html
          floatingBall: resolve('src/floating-ball.html')
        }
      }
    },
    plugins: [
      // Vue 3 SFC 支持
      vue(),

      // Element Plus 按需自動引入 API（ref, computed 等也一併處理）
      AutoImport({
        resolvers: [ElementPlusResolver()],
        imports: ['vue', 'vue-router', 'pinia'],
        // 必須用絕對路徑：electron-vite 的 renderer root 已是 src/，
        // 用相對路徑 'src/types/...' 會被解析成 <root>/src/types/...，
        // 也就是 src/src/types/，導致生成檔錯位、tsconfig 找不到，自動 import 類型實際失效。
        dts: resolve(__dirname, 'src/types/auto-imports.d.ts')
      }),

      // Element Plus 組件按需自動注冊
      Components({
        resolvers: [ElementPlusResolver()],
        // 同上，必須用絕對路徑
        dts: resolve(__dirname, 'src/types/components.d.ts')
      })
      // 注：i18n 沒有引入 unplugin-vue-i18n。
      // 我們在 src/locales/index.ts 提供了自定義 messageCompiler（CSP 安全），
      // 直接 import JSON 字典即可，不需要插件做預編譯。
    ]
  }
})
