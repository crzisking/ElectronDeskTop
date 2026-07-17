/**
 * 代辦頂部 dock 窗 Vue app 入口(docs/23 §3)。
 * 輕量:純 Vue,不引 Element Plus / Pinia / i18n。資料走主進程 IPC(見 todo-dock.preload)。
 */
import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#todo-dock-app')
