/**
 * AI Agent 子視窗 Vue app 入口(docs/19)。
 * 獨立子窗模式 — 自己的 renderer / Pinia / 生命週期;後端身分靠主進程 authContext + IPC。
 */

import {createApp} from 'vue'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {i18n} from '@/locales'
import App from './App.vue'

const app = createApp(App)

app.use(createPinia())
app.use(i18n)
app.use(ElementPlus)

// 全量註冊 ElementPlus 圖標為全局組件:auto-import 只能解析模板裡的標籤名,
// 解析不了 <component :is="字串名"> 這種動態圖標(跟主窗 main.ts 同一原因),故仍需全量註冊。
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
}

app.mount('#agent-app')
