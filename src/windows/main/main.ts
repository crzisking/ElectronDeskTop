/**
 * 主窗口 Vue 應用入口。
 * 用於:src/windows/main/index.html 載入後啟動整個渲染進程的 Vue 樹。
 * 注冊順序:Pinia → Router → ElementPlus → 全部圖標 → 掛載 #app。
 */

import {createApp} from 'vue'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import router from '@/router'
import App from './App.vue'
// i18n 必須在 ElementPlus 之前 use,因為 App.vue 的 <el-config-provider> 需要 i18n locale
import {i18n} from '@/locales'
// global.css 必須在 element-plus 樣式之後引入,才能透過 :root 變量覆蓋主題色
import '@/styles/global.css'
// 全局未捕獲異常 / Promise rejection 自動寫日誌(生產環境用戶端排錯用)
import {installGlobalErrorHandlers} from '@/shared/utils/logger'

const app = createApp(App)

// Pinia 必須在 router 之前注冊，路由守衛會用到 authStore
const pinia = createPinia()
app.use(pinia)

app.use(router)
app.use(i18n)

// Element Plus 內建組件文案（如 ElDatePicker）由 App.vue 的 <el-config-provider> 動態提供，
// 這裡不再傳 locale 選項，避免初始硬編碼語言無法跟隨切換
app.use(ElementPlus)

// 全量注冊圖標為全局組件，讓 SidebarNavItem 可以用字符串名稱動態渲染 <component :is>
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
}

app.mount('#app')

installGlobalErrorHandlers()
