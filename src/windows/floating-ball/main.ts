/**
 * 浮球窗口 Vue 應用入口
 *
 * 獨立的第二個 Vue 應用（與主窗口分開），
 * 掛載到 floating-ball.html 中的 #floating-ball-app 元素。
 *
 * 浮球窗口功能簡單，只需 Vue 3 基礎運行時。
 * 右鍵菜單由主進程原生 Menu 彈出，不需要 Element Plus。
 */

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#floating-ball-app')
