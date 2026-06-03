<script lang="ts" setup>
/**
 * Agent 窗口 — ChatGPT 風格佈局,薄殼。
 *
 *   ┌──────────────┬───────────────────────────────────────────┐
 *   │              │ AgentTopbar(對話標題 + 模型)            │
 *   │ AgentSidebar ├───────────────────────────────────────────┤
 *   │              │ AgentThread(訊息列表 / 歡迎頁)            │
 *   │              ├───────────────────────────────────────────┤
 *   │              │ AgentInput(輸入框 / 發送)                │
 *   └──────────────┴───────────────────────────────────────────┘
 *
 * + AgentSettingsDialog / AgentPromptDialog 兩個浮層。
 *
 * 拆分前 1549 行,拆完主檔約 200 行。詳見 docs/24 §5.1。
 */

import {computed, nextTick, onMounted, ref, toRaw} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useAgentStore} from './store'
import {useAgentChat} from './composables/useAgentChat'
import {initProvidersIfEmpty} from './composables/fetch-providers'
import AgentSidebar from './components/AgentSidebar.vue'
import AgentTopbar from './components/AgentTopbar.vue'
import AgentThread from './components/AgentThread.vue'
import AgentInput from './components/AgentInput.vue'
import AgentSettingsDialog from './components/AgentSettingsDialog.vue'
import AgentPromptDialog from './components/AgentPromptDialog.vue'
import type {AgentMessage, ConversationSummary} from './types'

const store = useAgentStore()
const {sendMessage, abort} = useAgentChat()

const input = ref('')
const conversations = ref<ConversationSummary[]>([])
const settingsOpen = ref(false)
const promptOpen = ref(false)
const inputRef = ref<{ focus?: () => void } | null>(null)
const threadRef = ref<{ scrollToBottom?: () => void } | null>(null)

// ── 初始化 ───────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const saved = await window.agentAPI.readConfig()
    if (saved && Object.keys(saved).length > 0) {
      store.setConfig(saved)
    }
    // 本地無 providers → 嘗試從 TMBOM 後端拉一次(stub 階段返回 null,等接入後生效)
    const fromBackend = await initProvidersIfEmpty(store.config.providers)
    if (fromBackend && fromBackend.length > 0) {
      store.setProviders(fromBackend)
      await window.agentAPI.writeConfig({
        providers: fromBackend,
        activeProviderId: store.config.activeProviderId,
      })
    }
    await refreshConversations()
    // active provider 未就緒(沒 key 或沒 model)→ 自動彈設定
    if (!store.isReady) settingsOpen.value = true
  } catch (err) {
    console.error('讀取 agent 配置失敗', err)
  }
})

async function refreshConversations(): Promise<void> {
  conversations.value = await window.agentAPI.listConversations()
}

// ── 發送 ─────────────────────────────────────────────────────────
async function onSend(): Promise<void> {
  const text = input.value.trim()
  if (!text || store.status === 'running') return
  input.value = ''
  await sendMessage(text)
  // 不管新舊對話都刷新(更新 lastTime 排序)
  await refreshConversations()
}

// ── 對話切換 ─────────────────────────────────────────────────────
async function onNewConversation(): Promise<void> {
  if (store.status === 'running') abort()
  store.startNewConversation()
  await nextTick()
  inputRef.value?.focus?.()
}

async function onSelectConversation(c: ConversationSummary): Promise<void> {
  if (c.conversationId === store.conversationId) return
  if (store.status === 'running') abort()
  const msgs = await window.agentAPI.listMessages(c.conversationId, 500)
  store.loadConversation(c.conversationId, msgs as AgentMessage[])
  // 切到歷史對話 → 滾到底,符合 chat UX
  await nextTick()
  threadRef.value?.scrollToBottom?.()
}

async function onDeleteConversation(c: ConversationSummary, ev: Event): Promise<void> {
  ev.stopPropagation()
  try {
    await ElMessageBox.confirm(`確定刪除「${c.title}」嗎?此操作不可復原。`, '刪除對話', {
      type: 'warning',
      confirmButtonText: '刪除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await window.agentAPI.clearMessages(c.conversationId)
  if (c.conversationId === store.conversationId) store.startNewConversation()
  await refreshConversations()
  ElMessage.success('已刪除')
}

// ── 設定保存(Settings 跟 PromptDialog 共用)──────────────────────
async function onSaveSettings(): Promise<void> {
  // toRaw 拆 reactive proxy(否則 ipcRenderer.invoke 的 structuredClone 會炸)
  await window.agentAPI.writeConfig({
    providers: toRaw(store.config.providers ?? []).map((p) => ({...p})),
    activeProviderId: store.config.activeProviderId,
    systemPrompt: store.config.systemPrompt,
    temperature: store.config.temperature,
    maxTurns: store.config.maxTurns,
    thinkingEnabled: store.config.thinkingEnabled,
    reasoningEffort: store.config.reasoningEffort,
  })
  settingsOpen.value = false
  promptOpen.value = false
  ElMessage.success('設定已保存')
}

// ── UI 計算屬性 ──────────────────────────────────────────────────
const visibleMessages = computed(() => store.visibleMessages as AgentMessage[])

/** 當前對話的標題(從 conversations 找,找不到顯示「新對話」) */
const currentTitle = computed(() => {
  const c = conversations.value.find((x) => x.conversationId === store.conversationId)
  return c?.title ?? '新對話'
})

const canSend = computed(() => input.value.trim().length > 0 && store.isReady)
</script>

<template>
  <div class="agent-app">
    <AgentSidebar
        :active-conversation-id="store.conversationId"
        :conversations="conversations"
        @delete-conversation="onDeleteConversation"
        @new-conversation="onNewConversation"
        @open-prompt="promptOpen = true"
        @open-settings="settingsOpen = true"
        @select-conversation="onSelectConversation"
    />

    <section class="main">
      <AgentTopbar :active-provider="store.activeProvider" :title="currentTitle"/>

      <AgentThread
          ref="threadRef"
          :error-message="store.errorMessage"
          :is-ready="store.isReady"
          :messages="visibleMessages"
          :status="store.status"
          @pick-example="(t) => (input = t)"
      />

      <AgentInput
          ref="inputRef"
          v-model="input"
          :can-send="canSend"
          :disabled="store.status === 'running'"
          :is-running="store.status === 'running'"
          @abort="abort"
          @send="onSend"
      />
    </section>

    <AgentSettingsDialog v-model:open="settingsOpen" @save="onSaveSettings"/>
    <AgentPromptDialog v-model:open="promptOpen" @save="onSaveSettings"/>
  </div>
</template>

<style>
/*
  Agent 全局 token —— 對齊主窗 --app-* 變數命名,色值獨立(ChatGPT 風淺色)。
  本檔不 scoped,讓子組件也能用這套 token。
*/
:root {
  /* ── 色值:Agent 走 ChatGPT 風淺色 palette ────────────────── */
  --bg: #ffffff;
  --bg-sidebar: #f7f7f8;
  --bg-elevated: #ffffff;
  --bg-hover: #ececf1;
  --bg-active: #e5e5ea;
  --bg-input: #f4f4f5;
  --bg-tool: #fafafa;
  --border: #e5e5ea;
  --border-strong: #d1d1d6;
  --text: #1a1a1a;
  --text-secondary: #4a4a4a;
  --text-muted: #8e8e93;
  --text-faint: #b0b0b6;
  /* accent 走 ChatGPT 綠,不沿用主窗 --app-accent(品牌藍),刻意視覺隔離 */
  --accent: #10a37f;
  --accent-hover: #0e8e6e;
  --danger: var(--app-danger, #e54a4a);
  --warning: var(--app-warning, #d97706);

  /* ── 可共用 token:從主窗繼承,fallback 給未載入時兜底 ─── */
  --shadow-sm: var(--app-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.04));
  --shadow-md: var(--app-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.08));
  --radius-sm: var(--app-radius-xs, 6px);
  --radius: var(--app-radius-md, 10px);
  --radius-lg: var(--app-radius-lg, 14px);
  --font: var(--app-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif);
  --font-mono: var(--app-font-mono, ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace);
}

html, body, #agent-app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
}

* {
  box-sizing: border-box;
}

/* 滾動條樣式統一 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #d1d1d6;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #b0b0b6;
}
</style>

<style scoped>
.agent-app {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
  /* rows: 1fr 強制單行充滿 viewport,讓 .main 內部 flex 子項正確分配高度 */
  grid-template-rows: 1fr;
  background: var(--bg);
  overflow: hidden;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* min-height:0 讓 thread(flex:1 + overflow auto)能正確收縮,
     composer 才會固定在底部不被推下螢幕 */
  min-height: 0;
  height: 100%;
  background: var(--bg);
}
</style>
