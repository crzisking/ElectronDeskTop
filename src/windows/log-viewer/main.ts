/**
 * 日誌查看器子視窗 Vue app 入口。
 *
 * 階段一原本是輕量單頁(只有 ElementPlus),階段二改造後承載多個管理員 tab,
 * 需要 pinia(configStore / workCollectStore)+ i18n(WorkCollectView 大量 t())。
 * 仍**沒有** router —— LogViewer 內部 tab 切換用 ref 狀態管即可,夠用。
 *
 * 三個窗口的 pinia 是各自獨立的 store instance(因為是不同 renderer process),
 * 在 LogViewer 內 useWorkCollectStore().bootstrap('viewer') 不會跟主窗口衝突。
 */

import {createApp} from 'vue'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {i18n} from '@/locales'
import App from './App.vue'

const app = createApp(App)

// Pinia:configStore / workCollectStore 共用
app.use(createPinia())

// i18n:WorkCollectView 用到大量 t('workCollect.*');先掛 i18n 再掛 ElementPlus
app.use(i18n)
app.use(ElementPlus)

// 全量註冊 ElementPlus 圖標(跟主窗對齊,方便子件動態 <component :is>)
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
}

app.mount('#log-viewer-app')
