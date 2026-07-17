/**
 * 代辦備注小窗 Vue app 入口(docs/23)。
 * 刻意輕量:純 Vue,不引 Element Plus / Pinia / i18n。存備注走主進程 IPC(見 todo-note.preload)。
 */
import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#todo-note-app')
