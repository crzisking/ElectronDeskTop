/**
 * 浮球窗口 Vue 應用入口
 *
 * 這是獨立的第二個 Vue 應用（與主窗口分開），
 * 掛載到 floating-ball.html 中的 #floating-ball-app 元素。
 *
 * 浮球窗口功能簡單，只需：
 *  - Vue 3 基礎運行時
 *  - Element Plus（QuickMenu 使用了部分 el-* 組件樣式變量）
 *
 * 注意：
 *  - 不需要 Vue Router（浮球無頁面切換）
 *  - 不需要 Pinia（狀態直接通過 IPC 獲取）
 *  - Element Plus 圖標不需要全量注冊（浮球未使用圖標組件）
 */

import { createApp } from 'vue'
import ElementPlus from 'element-plus'
// Element Plus 基礎樣式（浮球 QuickMenu 使用 CSS 變量）
import 'element-plus/dist/index.css'

import App from './App.vue'

// 創建並掛載浮球 Vue 應用
const app = createApp(App)

// 注冊 Element Plus（提供 CSS 變量和基礎組件）
app.use(ElementPlus)

// 掛載到 floating-ball.html 定義的根元素
app.mount('#floating-ball-app')
