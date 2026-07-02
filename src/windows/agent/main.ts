/**
 * AI Agent 子視窗 Vue app 入口(docs/19)。
 * 跟備忘錄窗同模式 — 獨立 renderer / Pinia / 生命週期;後端身分靠主進程 authContext + IPC。
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

// 全量註冊 ElementPlus 圖標,跟主窗 / 備忘窗對齊
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
}

app.mount('#agent-app')
