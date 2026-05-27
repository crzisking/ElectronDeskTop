/**
 * Agent 獨立窗口 Vue app 入口。
 *
 * 第四個獨立 Vue 應用(主窗 / 浮球 / log-viewer / 本視窗),掛載到 agent.html 內。
 * 包含 Element Plus(訊息列表 / 對話卡片 / 按鈕)+ Pinia(對話狀態 store)。
 * 不需要 router / i18n —— 視窗自閉,內部不切頁,文案直接寫繁中。
 */
import {createApp} from 'vue'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus)
app.mount('#agent-app')
