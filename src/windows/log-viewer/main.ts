/**
 * 日誌查看器子視窗 Vue app 入口。
 *
 * 獨立的第三個 Vue 應用(主窗 / 浮球 / 本視窗),掛載到 log-viewer.html 內。
 *
 * 包含 Element Plus 因為要用 el-table / el-pagination / el-select 等元件。
 * 不需要 router / pinia / i18n —— 視窗自閉,內部不切頁、不跨組件共享狀態、
 * 只有管理員看,文案直接寫繁中即可。
 */

import {createApp} from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

createApp(App).use(ElementPlus).mount('#log-viewer-app')
