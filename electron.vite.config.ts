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
import {cpSync, existsSync, mkdirSync} from 'fs'
import {defineConfig, externalizeDepsPlugin} from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'

/**
 * 把 drizzle migrations 整個目錄(SQL + meta/)拷貝到 out/main/migrations/。
 *
 * 為什麼自寫而不用 vite-plugin-static-copy:
 *  - 那個套件的 glob 行為會把來源目錄結構帶過去,變成 out/main/migrations/electron/main/db/migrations/...
 *  - 我們要的是「攤平」—— DatabaseManager 預期 migrations 直接在 out/main/migrations/ 下
 *  - 直接 cpSync 一行解決,維護成本更低
 */
function copyMigrationsPlugin() {
  return {
    name: 'copy-drizzle-migrations',
    closeBundle() {
      const src = resolve(__dirname, 'electron/main/db/migrations')
      const dest = resolve(__dirname, 'out/main/migrations')
      if (!existsSync(src)) return
      mkdirSync(dest, {recursive: true})
      cpSync(src, dest, {recursive: true})
    },
  }
}

export default defineConfig({
  // ─── 主進程配置 ────────────────────────────────────────────────
  main: {
    plugins: [
        // 將所有 node_modules 依賴標記為 external（主進程直接 require，不打包進去）。
        // ⚠️ 例外:Vercel AI SDK(ai / @ai-sdk/*)是純 ESM,而 Electron 28 內建 Node 18 不支援
        // require(ESM),外部化後打包/運行會 crash。故排除外部化 → 讓 vite 打包進 main(ESM→CJS)。
        // 它們的 @ai-sdk/* 傳遞依賴不在 package.json deps,本來就會一起被打包;zod 是 CJS,留 external 無妨。
        externalizeDepsPlugin({exclude: ['ai', '@ai-sdk/openai-compatible']}),
      // drizzle migrations 拷貝(自寫 plugin,見檔頂註解)
      copyMigrationsPlugin()
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
          floatingBall: resolve('electron/preload/floating-ball.preload.ts'),
          // 日誌查看器子視窗預加載腳本 → out/preload/log-viewer.preload.js
          'log-viewer.preload': resolve('electron/preload/log-viewer.preload.ts'),
            // AI Agent 子視窗預加載腳本 → out/preload/agent.preload.js
            'agent.preload': resolve('electron/preload/agent.preload.ts'),
            // 靈感速記速記小窗預加載腳本 → out/preload/idea-capture.preload.js
            'idea-capture.preload': resolve('electron/preload/idea-capture.preload.ts')
        }
      }
    }
  },

  // ─── 渲染進程配置 ────────────────────────────────────────────
  renderer: {
    // electron-vite 默認 renderer root 為 src/renderer/，
    // 本項目所有渲染源碼在 src/，顯式覆蓋以確保 HTML 入口路徑正確
    root: resolve('src'),
      // ⚠️ Vite 預設從 root(=src/)讀 .env.*,但我們的 .env.production / .env.development
      // 放在「項目根目錄」。不指 envDir 的話,生產打包讀不到 VITE_WORK_COLLECT_API_URL 等變數,
      // 程式 fallback 到 localhost:5247 → 正式環境連不上後端(ECONNREFUSED)。
      // 顯式把 envDir 指回項目根,讓 .env.* 正確注入。
      envDir: resolve(__dirname),
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
            // 各窗口 entry 統一在 src/windows/<name>/index.html。
          // 各自輸出到 out/renderer/src/windows/<name>/index.html
          // main 進程 loadFile 對應這個輸出路徑。
          index: resolve('src/windows/main/index.html'),
          floatingBall: resolve('src/windows/floating-ball/index.html'),
          logViewer: resolve('src/windows/log-viewer/index.html'),
            agent: resolve('src/windows/agent/index.html'),
            ideaCapture: resolve('src/windows/idea-capture/index.html')
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
