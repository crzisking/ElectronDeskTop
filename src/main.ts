/**
 * 主窗口 Vue 應用入口。
 * 用於：src/index.html 載入後啟動整個渲染進程的 Vue 樹。
 * 注冊順序：Pinia → Router → ElementPlus → 全部圖標 → 掛載 #app。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import router from './router'
import App from './App.vue'
// global.css 必須在 element-plus 樣式之後引入，才能透過 :root 變量覆蓋主題色
import './styles/global.css'

const app = createApp(App)

// Pinia 必須在 router 之前注冊，路由守衛會用到 authStore
const pinia = createPinia()
app.use(pinia)

app.use(router)

app.use(ElementPlus, {
  locale: zhTw,
})

// 全量注冊圖標為全局組件，讓 SidebarNavItem 可以用字符串名稱動態渲染 <component :is>
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.mount('#app')

// 全局未捕獲異常 / Promise rejection 自動寫日誌（生產環境用戶端排錯用）
import { installGlobalErrorHandlers } from './utils/logger'
installGlobalErrorHandlers()
