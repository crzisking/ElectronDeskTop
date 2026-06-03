/**
 * Agent 獨立窗口入口(對應 src/entries/agent/index.html)。
 *
 * 4 個獨立 Vue app(主窗 / 浮球 / log-viewer / agent)之一,業務 view 在
 * `@/features/agent/AgentWindow.vue`。本檔只負責掛載編排。
 *
 * 包含 Element Plus(訊息列表 / 對話卡片 / 按鈕)+ Pinia(對話狀態 store)。
 * 不需要 router / i18n —— 視窗自閉,內部不切頁,文案直接寫繁中。
 */
import {createApp} from 'vue'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// 共用主窗的設計 token(--app-* 變數):字型、尺寸、圓角、陰影都從這裡來。
// Agent 內部色值 palette(accent / bg / 等)在 AgentWindow.vue 的 .agent-app scope 內覆寫,
// 保持 Agent 視覺風格獨立,但 token 命名與主窗統一。
import '@/styles/global.css'
// vue-virtual-scroller(對話訊息列表虛擬化,doc 18 §3A)— DynamicScroller 的內建 CSS
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import AgentWindow from '@/features/agent/AgentWindow.vue'

const app = createApp(AgentWindow)
app.use(createPinia())
app.use(ElementPlus)
app.mount('#agent-app')
