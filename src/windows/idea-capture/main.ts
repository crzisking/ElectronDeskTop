/**
 * 靈感速記小窗 Vue app 入口(docs/21)。
 * 刻意輕量:純 Vue,不引 Element Plus / Pinia / i18n —— Spotlight 式小窗要快、要簡潔,
 * 後端身分靠主進程 authContext + IPC(見 idea-capture.preload)。
 */
import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#idea-app')
