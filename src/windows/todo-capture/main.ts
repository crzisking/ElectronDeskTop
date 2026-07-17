/**
 * 代辦錄入小窗 Vue app 入口(docs/23)。
 * 刻意輕量:純 Vue,不引 Element Plus / Pinia / i18n —— Spotlight 式小窗要快要簡潔。
 * 錄入走主進程 IPC(見 todo-capture.preload)。
 */
import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#todo-app')
