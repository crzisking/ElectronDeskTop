/**
 * 備忘錄子視窗 Vue app 入口。
 *
 * 跟 LogViewer 同模式 — 獨立 renderer,獨立 Pinia,獨立生命週期。
 * 主窗的 Pinia state 跨進程無法共享,身分認證資料靠主進程 authContext + IPC。
 *
 * 為什麼獨立窗口(對齊 user 需求):
 *   - 使用者頻繁切回備忘錄記快速筆記,不該每次切換頁面打斷主窗的長流程
 *   - 跟桌面右下角貼紙便利貼一樣,常駐 / 隨手可達
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

// 全量註冊 ElementPlus 圖標,跟主窗對齊
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
}

app.mount('#memos-app')
