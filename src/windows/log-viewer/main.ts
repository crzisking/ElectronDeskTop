/**
 * 日誌查看器子視窗 Vue app 入口。
 *
 * 目前只裝 LogViewerView(日誌頁)。工作採集已搬回主視窗的「個人功能」入口,
 * 不再 piggyback 在 LogViewer 內。pinia / i18n 仍保留,未來新增子件需要時直接可用,
 * 零成本。
 *
 * 三個窗口的 pinia 各自獨立 store instance(不同 renderer process),互不共享狀態 —
 * 之後若要在此窗口用任何 store,呼叫對應 use*Store() 即可,跟主窗口完全隔離。
 */

import {createApp} from 'vue'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {i18n} from '@/locales'
import App from './App.vue'

const app = createApp(App)

// Pinia / i18n:LogViewerView 目前用不到,但保留以便未來新增子件需要時直接可用
app.use(createPinia())
app.use(i18n)
app.use(ElementPlus)

// 全量註冊 ElementPlus 圖標(跟主窗對齊,方便子件動態 <component :is>)
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
}

app.mount('#log-viewer-app')
