/**
 * Vitest 單元測試配置。
 *
 * 範圍:聚焦純函數 / 決策邏輯(格式化、聚合、過濾、權限/到期判斷、URL 拼接、JSON 解析),
 * 不做脆弱的 UI 快照測試。三進程的可測邏輯共用一份配置。
 *
 * 環境:預設 node(純邏輯不需要 DOM,啟動快)。個別需要 DOM/Vue 的測試檔
 *       可在檔頂用 `// @vitest-environment happy-dom` 局部切換。
 *
 * alias 與 electron.vite.config.ts 對齊:@ → src,@shared → electron/shared。
 */
import {resolve} from 'path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@shared': resolve(__dirname, 'electron/shared'),
            '@main': resolve(__dirname, 'electron/main'),
        },
    },
    test: {
        environment: 'node',
        globals: true,
        // 只收 tests 目錄下的測試,跟業務碼分離,build 不會誤打包
        include: ['tests/**/*.{test,spec}.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'coverage',
            include: [
                'src/shared/utils/**',
                'src/features/work-collect/charts/**',
                'src/features/work-collect/category-colors.ts',
                'src/views/Home/**',
                'electron/main/services/**',
                'electron/main/work-collect/time-utils.ts',
            ],
        },
    },
})
