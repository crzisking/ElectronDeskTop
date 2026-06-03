/**
 * ESLint flat config — Vue 3 + TypeScript + Electron。
 *
 * 分區策略:
 *   1. 全域 ignores                  out / dist / build / auto-generated d.ts / migrations
 *   2. 通用 JS / TS                  recommended 規則 + 專案常見容忍
 *   3. Vue SFC                       eslint-plugin-vue 的 flat/recommended,parser 內嵌 TS
 *   4. 主進程(electron/main)       Node globals
 *   5. preload                       Browser + Node globals(沙盒裡兩邊都摸得到)
 *   6. renderer(src/)               Browser globals + Vue 自動導入的 Composition API
 *
 * 規則挑選邏輯:
 *  - 不開 type-aware(parserOptions.project),保持單機快、tsc 已經負擔型別檢查
 *  - 不跟 prettier 比格式;後續若加 prettier 再裝 eslint-config-prettier 關掉衝突
 *  - 先 recommended 起步,有雜訊再逐條降為 warn / off
 */

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
    // ── 1. 全域 ignores(必須是第一條,且只含 ignores 鍵)──────────
    {
        ignores: [
            'node_modules/**',
            'out/**',
            'dist/**',
            'build/**',
            'resources/**',
            // 自動產生,不掃
            'src/types/auto-imports.d.ts',
            'src/types/components.d.ts',
            // drizzle 產的 SQL + meta,非源碼
            'electron/main/db/migrations/**',
            // 配置自身免掃(避免 self-referential 規則衝突)
            'eslint.config.mjs',
            'drizzle.config.ts',
            'electron.vite.config.ts',
        ],
    },

    // ── 2. JS / TS 通用 ─────────────────────────────────────────
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            // TS 已經管 no-undef,ESLint 再管會誤報 type-only 引用
            'no-undef': 'off',
            // 未使用變數降為 warn;允許 _ 開頭代表「故意不用」
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
            // any 太多歷史包袱,降為 warn
            '@typescript-eslint/no-explicit-any': 'warn',
            // IPC 邊界常用空 interface 做 type alias,放行
            '@typescript-eslint/no-empty-object-type': 'off',
            // 偶爾要 ts-ignore 跨 sandbox 解決奇怪型別,允許但需註解理由
            '@typescript-eslint/ban-ts-comment': ['warn', {
                'ts-ignore': 'allow-with-description',
                'ts-expect-error': 'allow-with-description',
            }],
            // 真實 bug 防護
            'no-debugger': 'warn',
            'no-console': 'off', // 主進程大量 console + logger,不阻擋
            'prefer-const': 'warn',
            'eqeqeq': ['warn', 'smart'],
        },
    },

    // ── 3. Vue SFC ──────────────────────────────────────────────
    ...vue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            // Vue SFC 的 <script lang="ts"> 用 TS parser
            parserOptions: {
                parser: tseslint.parser,
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // Vue 3 SFC 不強制多單字組件名(內部組件叫 App / Login 很常見)
            'vue/multi-word-component-names': 'off',
            // 純格式規則一律關;格式交給 IDE / 未來的 prettier 處理,
            // ESLint 只負責「邏輯陷阱」(未使用 import、computed 沒 return、誤用 v-html…)
            'vue/attributes-order': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/multiline-html-element-content-newline': 'off',
            'vue/html-self-closing': 'off',
            'vue/html-indent': 'off',
            'vue/html-closing-bracket-spacing': 'off',
            'vue/html-closing-bracket-newline': 'off',
            'vue/first-attribute-linebreak': 'off',
            // v-html 用 dompurify 處理過的場景多,降為 warn 而非 error
            'vue/no-v-html': 'warn',
        },
    },

    // ── 4. 主進程 ───────────────────────────────────────────────
    {
        files: ['electron/main/**/*.{ts,js}'],
        languageOptions: {
            globals: {...globals.node},
            sourceType: 'module',
        },
    },

    // ── 5. preload ──────────────────────────────────────────────
    {
        files: ['electron/preload/**/*.{ts,js}'],
        languageOptions: {
            // preload 同時可見 Node API(ipcRenderer) 與 DOM(contextBridge 暴露給 window)
            globals: {...globals.node, ...globals.browser},
            sourceType: 'module',
        },
    },

    // ── 6. renderer(Vue + Composition API 自動導入)─────────────
    {
        files: ['src/**/*.{ts,tsx,vue}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                // unplugin-auto-import 注入的 Vue / Pinia / Router API,
                // 規則層面當作全域避免 no-undef 報錯(其實 no-undef 已 off,留著對 IDE 友善)
                ref: 'readonly',
                computed: 'readonly',
                reactive: 'readonly',
                watch: 'readonly',
                watchEffect: 'readonly',
                onMounted: 'readonly',
                onUnmounted: 'readonly',
                onBeforeMount: 'readonly',
                onBeforeUnmount: 'readonly',
                nextTick: 'readonly',
                defineProps: 'readonly',
                defineEmits: 'readonly',
                defineExpose: 'readonly',
                withDefaults: 'readonly',
                shallowRef: 'readonly',
                toRefs: 'readonly',
                useRouter: 'readonly',
                useRoute: 'readonly',
            },
        },
    },
)
