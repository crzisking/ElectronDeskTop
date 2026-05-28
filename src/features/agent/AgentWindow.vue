<script lang="ts" setup>
/**
 * Agent 窗口 — ChatGPT 風格佈局。
 *
 *   ┌──────────────┬───────────────────────────────────────────┐
 *   │              │ topbar:對話標題 + 模型 + 動作按鈕         │
 *   │  sidebar     ├───────────────────────────────────────────┤
 *   │  ─────────   │                                           │
 *   │  [+ 新對話]   │   訊息列表(空態 / user / assistant)      │
 *   │              │                                           │
 *   │  對話 1       │                                           │
 *   │  對話 2       │                                           │
 *   │  ...         ├───────────────────────────────────────────┤
 *   │              │   輸入框 + 發送 / 中止                    │
 *   └──────────────┴───────────────────────────────────────────┘
 *
 * 對話列表:從 SQLite 撈,點擊載入歷史;hover 顯示刪除按鈕。
 * 整體配色走淺色簡潔風,跟 ChatGPT / Claude.ai 對齊,刻意去掉先前的暗色 + Element Plus
 * 重氣息的元素(設定改用浮層而非抽屜,按鈕改用簡約 ghost 樣式)。
 */

import {computed, nextTick, onMounted, ref, toRaw, watch} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
// (已回退)vue-virtual-scroller import — 留待對話真的超過 200 則時再接回,
// 目前場景 < 100 訊息走 v-for + v-memo 完全夠用,虛擬化的 item-size 估算誤差反而把
// 最後一條訊息高度算少,造成「底部缺一截」的視覺 bug。
import {useAgentStore} from './store'
import {useAgentChat} from './composables/useAgentChat'
import {fetchModels, invalidateModelsCache} from './composables/fetch-models'
import {initProvidersIfEmpty} from './composables/fetch-providers'
import ChatMessage from './components/ChatMessage.vue'
import type {AgentMessage, ConversationSummary, ProviderConfig} from './types'

const store = useAgentStore()
const {sendMessage, abort} = useAgentChat()

const input = ref('')
const conversations = ref<ConversationSummary[]>([])
const sidebarCollapsed = ref(false)
const settingsOpen = ref(false)
const promptOpen = ref(false)
const listRef = ref<HTMLElement | null>(null)
const textareaRef = ref<{ focus?: () => void } | null>(null)

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
      // 落地到 SQLite,下次啟動直接讀本地
      await window.agentAPI.writeConfig({
        providers: fromBackend,
        activeProviderId: store.config.activeProviderId,
      })
    }
    await refreshConversations()
    // active provider 未就緒(沒 key 或沒 model)→ 自動彈設定
    if (!store.isReady) {
      settingsOpen.value = true
    }
  } catch (err) {
    console.error('讀取 agent 配置失敗', err)
  }
})

async function refreshConversations(): Promise<void> {
  conversations.value = await window.agentAPI.listConversations()
}

// ── 自動滾到底 ───────────────────────────────────────────────────
// 普通 scroll container:`.thread` 自己 overflow-y:auto,
// scrollTop = scrollHeight 即可滾到底。
// 兩次 RAF 確保 markdown 渲染 / CodeBlock upgrade 後重排完成才滾。
function scrollToBottom(): void {
  const el = listRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
    })
  })
}

watch(
    () => store.messages.length,
    () => nextTick(() => scrollToBottom())
)
watch(
    () => store.messages.map((m) => m.content?.length ?? 0).join('|'),
    () => nextTick(() => scrollToBottom())
)

// ── 發送 ─────────────────────────────────────────────────────────
async function onSend(): Promise<void> {
  const text = input.value.trim()
  if (!text || store.status === 'running') return
  const wasNewConvo = store.messages.length === 0
  input.value = ''
  await sendMessage(text)
  // 新對話發完首條 → 刷新側欄,讓它出現在列表
  if (wasNewConvo) await refreshConversations()
  else {
    // 既有對話:更新 lastTime 排序
    await refreshConversations()
  }
}

function onKeydown(evt: Event | KeyboardEvent): void {
  const e = evt as KeyboardEvent
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSend()
  }
}

// ── 對話切換 ─────────────────────────────────────────────────────
async function onNewConversation(): Promise<void> {
  if (store.status === 'running') abort()
  store.startNewConversation()
  await nextTick()
  textareaRef.value?.focus?.()
}

async function onSelectConversation(c: ConversationSummary): Promise<void> {
  if (c.conversationId === store.conversationId) return
  if (store.status === 'running') abort()
  const msgs = await window.agentAPI.listMessages(c.conversationId, 500)
  store.loadConversation(c.conversationId, msgs as AgentMessage[])
  // 切到歷史對話 → 滾到底,符合 chat UX(用戶通常看的是最新訊息);
  // nextTick 等 v-for 渲染完;scrollToBottom 內又跑兩次 RAF 等 markdown / CodeBlock 重排
  await nextTick()
  scrollToBottom()
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
  if (c.conversationId === store.conversationId) {
    store.startNewConversation()
  }
  await refreshConversations()
  ElMessage.success('已刪除')
}

// ── 設定保存 ─────────────────────────────────────────────────────
async function onSaveSettings(): Promise<void> {
  // 持久化新格式:providers + activeProviderId + 通用欄位。
  // toRaw 拆 reactive proxy(否則 ipcRenderer.invoke 的 structuredClone 會炸,見 useAgentChat 註解)
  // temperature 不再讓使用者調(固定 0.7,store DEFAULT_CONFIG 維持);UI 不暴露但仍會持久化既有值
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

// ── Provider 管理 UI 邏輯 ────────────────────────────────────────
const modelOptions = ref<string[]>([])
const modelLoading = ref(false)

/**
 * 對當前 active provider 拉一份 model 列表;UI 從 modelOptions 渲染下拉。
 * 觸發點:打開設定 / 切換 provider / 編輯 apiKey 後手動點「重新載入」
 *
 * @param force true 時清掉模組快取重新打網路(點 ↻ 按鈕走這條,
 *              否則 fetchModels 內部 cache hit 會直接返回舊資料)
 */
async function loadModels(force = false): Promise<void> {
  const p = store.activeProvider
  if (!p?.apiKey || !p.baseUrl) {
    modelOptions.value = []
    return
  }
  if (force) invalidateModelsCache(p.baseUrl, p.apiKey)
  modelLoading.value = true
  try {
    modelOptions.value = await fetchModels(p.baseUrl, p.apiKey)
  } finally {
    modelLoading.value = false
  }
}

/** 設定彈窗開啟 → 自動拉一次 model 列表 */
watch(settingsOpen, (open) => {
  if (open) void loadModels()
})

/** 切換 active provider:更新 store + 清掉舊的 model options,自動拉新的 */
function onSelectProvider(id: string): void {
  store.setActiveProviderId(id)
  modelOptions.value = []
  void loadModels()
}

/** 編輯 apiKey 後:清快取重拉 model 列表(換 key 後 model 列表可能變動) */
function onApiKeyChange(): void {
  const p = store.activeProvider
  if (p) invalidateModelsCache(p.baseUrl, p.apiKey)
}

/** 添加新 provider:用時間戳當 id,push 進 list 並切過去 */
function onAddProvider(): void {
  const newProvider: ProviderConfig = {
    id: `custom-${Date.now()}`,
    label: '自訂',
    baseUrl: 'https://',
    apiKey: '',
    model: '',
  }
  const list = [...(store.config.providers ?? []), newProvider]
  store.setProviders(list)
  store.setActiveProviderId(newProvider.id)
  modelOptions.value = []
}

/** 刪除當前 active provider(列表至少留 1 個,刪到只剩 1 個時禁用按鈕) */
function onDeleteProvider(): void {
  const list = store.config.providers ?? []
  if (list.length <= 1) return
  const filtered = list.filter((p) => p.id !== store.config.activeProviderId)
  store.setProviders(filtered)  // setProviders 內部會自動指到第一個
  modelOptions.value = []
  void loadModels()
}

// ── UI 計算屬性 ──────────────────────────────────────────────────
const visibleMessages = computed(() => store.visibleMessages as AgentMessage[])

/* toolsFollowing() 已移除:邏輯搬到 ChatMessage.vue 內,改用 toolCallId → ToolResult Map 索引 */

/** 對話列表時間顯示:今天顯示 HH:mm,昨天顯示「昨天」,更早顯示 M/D */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** 當前對話的標題(從 conversations 找,找不到顯示「新對話」) */
const currentTitle = computed(() => {
  const c = conversations.value.find((x) => x.conversationId === store.conversationId)
  return c?.title ?? '新對話'
})
</script>

<template>
  <div :class="{collapsed: sidebarCollapsed}" class="agent-app">
    <!-- ══════════ Sidebar ══════════ -->
    <aside class="sidebar">
      <div class="sidebar__head">
        <button class="btn-new" @click="onNewConversation">
          <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
               stroke-width="2"
               viewBox="0 0 24 24" width="16">
            <line x1="12" x2="12" y1="5" y2="19"/>
            <line x1="5" x2="19" y1="12" y2="12"/>
          </svg>
          <span>新對話</span>
        </button>
      </div>

      <div class="sidebar__list">
        <div v-if="conversations.length === 0" class="sidebar__empty">
          還沒有對話歷史
        </div>

        <!--
          用 div + role="button" 而非 <button> 包整列:
           - <button> 內按 HTML 規範只能放 phrasing content,div / 嵌套 button 都會觸發 IDE 警告
           - 嵌套 button 在某些瀏覽器也會把點擊事件吞掉
          delete 按鈕保留 button 語意(它本來就只該觸發刪除而非整列選取)
        -->
        <div
            v-for="c in conversations"
            :key="c.conversationId"
            :class="{'is-active': c.conversationId === store.conversationId}"
            class="convo"
            role="button"
            tabindex="0"
            @click="onSelectConversation(c)"
            @keydown.enter="onSelectConversation(c)"
            @keydown.space.prevent="onSelectConversation(c)"
        >
          <span class="convo__main">
            <span class="convo__title">{{ c.title }}</span>
            <span class="convo__meta">
              <span>{{ formatTime(c.lastTime) }}</span>
              <span class="dot">·</span>
              <span>{{ c.messageCount }} 則</span>
            </span>
          </span>
          <button
              class="convo__del"
              title="刪除對話"
              @click="onDeleteConversation(c, $event)"
          >
            <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                 stroke-width="2"
                 viewBox="0 0 24 24" width="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="sidebar__foot">
        <button class="btn-ghost" @click="promptOpen = true">
          <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
               stroke-width="2"
               viewBox="0 0 24 24" width="14">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>System Prompt</span>
        </button>
        <button class="btn-ghost" @click="settingsOpen = true">
          <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
               stroke-width="2"
               viewBox="0 0 24 24" width="14">
            <circle cx="12" cy="12" r="3"/>
            <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>設定</span>
        </button>
      </div>
    </aside>

    <!-- ══════════ Main ══════════ -->
    <section class="main">
      <header class="topbar">
        <div class="topbar__title">
          <h1>{{ currentTitle }}</h1>
          <span v-if="store.activeProvider" class="model-pill">
            {{ store.activeProvider.label }} · {{ store.activeProvider.model || '未選 model' }}
          </span>
        </div>
      </header>

      <main ref="listRef" class="thread">
        <!-- 空狀態 -->
        <div v-if="visibleMessages.length === 0" class="welcome">
          <div class="welcome__logo">
            <svg fill="none" height="32" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                 stroke-width="1.6"
                 viewBox="0 0 24 24" width="32">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="4"/>
            </svg>
          </div>
          <h2>有什麼可以幫忙的嗎?</h2>
          <p>我可以開啟程式、讀寫檔案、執行命令、截取螢幕、操作剪貼簿。</p>

          <div class="example-grid">
            <button class="example" @click="input = '幫我打開記事本'">
              <span class="example__title">打開記事本</span>
              <span class="example__hint">open_app("notepad")</span>
            </button>
            <button class="example" @click="input = '幫我截一張當前螢幕的圖'">
              <span class="example__title">擷取螢幕</span>
              <span class="example__hint">screenshot()</span>
            </button>
            <button class="example" @click="input = '列出 C:\\Windows 目錄下的檔案'">
              <span class="example__title">列出檔案</span>
              <span class="example__hint">list_files("C:\\Windows")</span>
            </button>
            <button class="example" @click="input = '把剪貼簿的內容讀出來給我看'">
              <span class="example__title">讀取剪貼簿</span>
              <span class="example__hint">clipboard_read()</span>
            </button>
          </div>

          <div v-if="!store.isReady" class="warn-banner">
            ⚠ 請先到左下角「設定」配置 LLM 廠商(填 API Key + 選 model)
          </div>
        </div>

        <!--
          訊息列表(對應 doc 17 §1.1 / §9):
          - 純 v-for + v-memo(回退掉 doc 18 §3A 虛擬化)
          - 觸發條件:單對話訊息數 > 200 + 滾動 fps < 30,目前場景遠未達到
          - v-memo 鎖在 [id, content, streaming, toolCalls 長度, reasoningContent],
            streaming 中那條每幀 invalidate,其它條全 skip
        -->
        <div v-else class="msgs">
          <ChatMessage
              v-for="m in visibleMessages"
              :key="m.id"
              v-memo="[
                m.id,
                m.content,
                m.streaming,
                m.toolCalls?.length ?? 0,
                m.reasoningContent,
              ]"
              :message="m"
          />
          <div v-if="store.status === 'error'" class="error-line">
            ⚠ {{ store.errorMessage }}
          </div>
        </div>
      </main>

      <footer class="composer">
        <div class="composer__wrap">
          <textarea
              ref="textareaRef"
              v-model="input"
              :disabled="store.status === 'running'"
              class="composer__input"
              placeholder="傳訊息給 AI Agent...(Enter 發送,Shift+Enter 換行)"
              rows="1"
              @keydown="onKeydown"
          />
          <button
              v-if="store.status === 'running'"
              class="composer__btn composer__btn--stop"
              title="中止"
              @click="abort"
          >
            <svg fill="currentColor" height="16" viewBox="0 0 24 24" width="16">
              <rect height="12" rx="2" width="12" x="6" y="6"/>
            </svg>
          </button>
          <button
              v-else
              :disabled="!input.trim() || !store.isReady"
              class="composer__btn"
              title="發送"
              @click="onSend"
          >
            <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                 stroke-width="2.4"
                 viewBox="0 0 24 24" width="16">
              <line x1="12" x2="12" y1="19" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
        <div class="composer__hint">
          AI Agent 可能會出錯,涉及刪除 / 覆寫請仔細確認。
        </div>
      </footer>
    </section>

    <!-- ══════════ 設定浮層 ══════════ -->
    <transition name="overlay">
      <div v-if="settingsOpen" class="overlay" @click.self="settingsOpen = false">
        <div class="modal">
          <div class="modal__head">
            <h3>設定</h3>
            <button class="x-btn" @click="settingsOpen = false">✕</button>
          </div>
          <div class="modal__body">
            <!-- ───── Section 1:廠商 ───── -->
            <section class="settings-section">
              <header class="settings-section__head">
                <h4>LLM 廠商</h4>
                <span class="settings-section__hint">未來由 TMBOM 後端同步</span>
              </header>

              <div class="provider-bar">
                <select
                    :value="store.config.activeProviderId"
                    class="provider-bar__select"
                    @change="onSelectProvider(($event.target as HTMLSelectElement).value)"
                >
                  <option
                      v-for="p in store.config.providers ?? []"
                      :key="p.id"
                      :value="p.id"
                  >{{ p.label }}
                  </option>
                </select>
                <button
                    class="icon-btn"
                    title="添加廠商"
                    type="button"
                    @click="onAddProvider"
                >
                  <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-width="2"
                       viewBox="0 0 24 24" width="14">
                    <line x1="12" x2="12" y1="5" y2="19"/>
                    <line x1="5" x2="19" y1="12" y2="12"/>
                  </svg>
                </button>
                <button
                    :disabled="(store.config.providers?.length ?? 0) <= 1"
                    class="icon-btn icon-btn--danger"
                    title="刪除目前廠商"
                    type="button"
                    @click="onDeleteProvider"
                >
                  <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                       stroke-width="2" viewBox="0 0 24 24" width="14">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                  </svg>
                </button>
              </div>

              <template v-if="store.activeProvider">
                <label class="field">
                  <span class="field__label">名稱</span>
                  <input
                      :value="store.activeProvider.label"
                      class="field__input"
                      @input="store.updateActiveProvider({label: ($event.target as HTMLInputElement).value})"
                  />
                </label>
                <label class="field">
                  <span class="field__label">Base URL</span>
                  <input
                      :value="store.activeProvider.baseUrl"
                      class="field__input"
                      @input="store.updateActiveProvider({baseUrl: ($event.target as HTMLInputElement).value})"
                  />
                </label>
                <label class="field">
                  <span class="field__label">API Key</span>
                  <input
                      :value="store.activeProvider.apiKey"
                      class="field__input"
                      placeholder="貼上該廠商的 API Key"
                      type="password"
                      @change="onApiKeyChange"
                      @input="store.updateActiveProvider({apiKey: ($event.target as HTMLInputElement).value})"
                  />
                </label>
                <div class="field">
                  <span class="field__label">Model</span>
                  <div class="model-row">
                    <select
                        v-if="modelOptions.length > 0"
                        :value="store.activeProvider.model"
                        class="field__input model-row__select"
                        @change="store.updateActiveProvider({model: ($event.target as HTMLSelectElement).value})"
                    >
                      <option disabled value="">— 選擇 model —</option>
                      <option
                          v-for="m in modelOptions"
                          :key="m"
                          :value="m"
                      >{{ m }}
                      </option>
                    </select>
                    <input
                        v-else
                        :value="store.activeProvider.model"
                        class="field__input model-row__select"
                        placeholder="填 API Key 後點 ↻ 拉取;或手填"
                        @input="store.updateActiveProvider({model: ($event.target as HTMLInputElement).value})"
                    />
                    <button
                        :class="{loading: modelLoading}"
                        :disabled="modelLoading"
                        class="icon-btn"
                        title="重新拉取 model 列表(忽略快取)"
                        type="button"
                        @click="loadModels(true)"
                    >
                      <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                           stroke-width="2" viewBox="0 0 24 24" width="14">
                        <polyline points="23 4 23 10 17 10"/>
                        <polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </template>
            </section>

            <!-- ───── Section 2:Thinking 模式 ───── -->
            <section class="settings-section">
              <header class="settings-section__head">
                <h4>Thinking 模式</h4>
                <span class="settings-section__hint">DeepSeek V4 / Claude / o-series 才支援</span>
              </header>

              <label class="switch">
                <input
                    v-model="store.config.thinkingEnabled"
                    type="checkbox"
                />
                <span class="switch__track"/>
                <span class="switch__label">啟用思考鏈輸出</span>
              </label>

              <div v-if="store.config.thinkingEnabled" class="field">
                <span class="field__label">Reasoning Effort</span>
                <select v-model="store.config.reasoningEffort" class="field__input">
                  <option value="high">high — 預設,平衡速度與深度</option>
                  <option value="max">max — Agent 類複雜任務,代價更高</option>
                </select>
              </div>
            </section>

            <!-- ───── Section 3:對話控制 ───── -->
            <section class="settings-section">
              <header class="settings-section__head">
                <h4>對話控制</h4>
              </header>

              <label class="field">
                <span class="field__label">最大輪數</span>
                <input
                    v-model.number="store.config.maxTurns"
                    class="field__input"
                    max="30"
                    min="1"
                    type="number"
                />
                <span class="field__hint">單次對話最多走幾輪工具調用;達到上限自動停止</span>
              </label>
            </section>
          </div>
          <div class="modal__foot">
            <button class="btn-ghost" @click="settingsOpen = false">取消</button>
            <button class="btn-primary" @click="onSaveSettings">保存</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- ══════════ Prompt 浮層 ══════════ -->
    <transition name="overlay">
      <div v-if="promptOpen" class="overlay" @click.self="promptOpen = false">
        <div class="modal modal--lg">
          <div class="modal__head">
            <h3>System Prompt</h3>
            <button class="x-btn" @click="promptOpen = false">✕</button>
          </div>
          <div class="modal__body">
            <textarea
                v-model="store.config.systemPrompt"
                class="prompt-area"
                rows="20"
            />
          </div>
          <div class="modal__foot">
            <button class="btn-ghost" @click="promptOpen = false">取消</button>
            <button class="btn-primary" @click="onSaveSettings">保存</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style>
/*
  Agent 內部 token —— 改為「指向主窗 --app-* token」的本地別名(對齊 §1.11 重構)。
  動機:命名與主窗統一(共用一份設計 token 系統),Agent UI 風格獨立透過覆寫色值實現,
  而不是再 fork 一套變數名。

  分三類:
   1. 完全共用(尺寸 / 陰影 / 圓角 / 字型):直接 alias 到 --app-* 變數
   2. 色值有 palette 差異(accent 用 ChatGPT 綠 而非主窗藍):本檔 hard-code
   3. Agent 專屬的灰階層次(hover / active / faint 等):本檔自定,主窗沒有對等概念
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
  /* accent 走 ChatGPT 綠,不沿用主窗 --app-accent(品牌藍),這是刻意的視覺隔離 */
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
  /* grid 預設 row 為 auto,內容多會撐開;鎖死 1fr 強制單行充滿 viewport,
     讓 .main 內部的 flex 子項(thread 滾、composer 固定)正確分配高度 */
  grid-template-rows: 1fr;
  background: var(--bg);
  overflow: hidden;
}

/* ════════ Sidebar ════════ */
.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.sidebar__head {
  padding: 12px;
  flex-shrink: 0;
}

.btn-new {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn-new:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn-new svg {
  color: var(--text-secondary);
}

.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
  min-height: 0;
}

.sidebar__empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12.5px;
}

.convo {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  margin-bottom: 2px;
  transition: background 0.15s;
}

.convo:hover {
  background: var(--bg-hover);
}

.convo.is-active {
  background: var(--bg-active);
}

.convo__main {
  /* 從 div 改成 span 後需顯式設 block,才能讓 title / meta 堆疊並支援 flex:1 */
  display: block;
  flex: 1;
  min-width: 0;
}

.convo__title {
  display: block;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  margin-bottom: 2px;
}

.convo__meta {
  display: flex;
  font-size: 11px;
  color: var(--text-muted);
  align-items: center;
  gap: 4px;
}

.convo__meta .dot {
  color: var(--text-faint);
}

.convo__del {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.convo:hover .convo__del {
  opacity: 1;
}

.convo__del:hover {
  background: rgba(229, 74, 74, 0.1);
  color: var(--danger);
}

.sidebar__foot {
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.btn-ghost {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* ════════ Main ════════ */
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* grid item 預設 min-height:auto,讓子項可以撐破容器。
     設 0 讓 .thread(flex:1 + overflow auto)能正確收縮,
     composer 才會固定在底部不被推下螢幕 */
  min-height: 0;
  height: 100%;
  background: var(--bg);
}

.thread {
  /* 同樣讓 thread 自己不要 min-height:auto 撐高 flex 容器 */
  min-height: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg);
}

.topbar__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar__title h1 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-pill {
  padding: 2px 8px;
  background: var(--bg-input);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

/* ── 訊息區 ─────────────────────────────────────────────── */
/* .thread 自己是 scroll container;子元素佔滿即可。 */
.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 訊息列表:780px 居中、flex column + gap、底部 80px 留白(避免最後一條被 composer 卡到) */
.msgs {
  max-width: 780px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 24px 80px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/*
  .msg / .msg__* / .cursor / .tool / .tool__* 樣式已搬到 ChatMessage.vue 與 ToolCallCard.vue 內,
  本檔不再保留(對應 doc 17 §1 重構 — AgentWindow.vue 瘦身)。
*/

.error-line {
  align-self: center;
  padding: 8px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  font-size: 13px;
}

/* ── 歡迎頁 ───────────────────────────────────────────── */
.welcome {
  margin: auto;
  max-width: 640px;
  text-align: center;
  padding: 40px 24px;
}

.welcome__logo {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

.welcome h2 {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 8px;
}

.welcome p {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0 0 28px;
}

.example-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.example {
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}

.example:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.example:active {
  transform: scale(0.99);
}

.example__title {
  font-size: 13.5px;
  color: var(--text);
  font-weight: 500;
}

.example__hint {
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.warn-banner {
  margin-top: 12px;
  padding: 10px 14px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  font-size: 13px;
  color: #92400e;
}

/* ── Composer ────────────────────────────────────────── */
.composer {
  flex-shrink: 0;
  padding: 12px 24px 18px;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.composer__wrap {
  max-width: 780px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: flex-end;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.composer__wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

.composer__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  padding: 14px 14px 14px 18px;
  font-family: var(--font);
  font-size: 14.5px;
  color: var(--text);
  line-height: 1.55;
  max-height: 200px;
  min-height: 24px;
}

.composer__input::placeholder {
  color: var(--text-muted);
}

.composer__input:disabled {
  opacity: 0.5;
}

.composer__btn {
  width: 32px;
  height: 32px;
  margin: 8px 8px 8px 0;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, opacity 0.15s;
  flex-shrink: 0;
}

.composer__btn:hover {
  background: var(--accent-hover);
}

.composer__btn:disabled {
  background: var(--bg-active);
  color: var(--text-faint);
  cursor: not-allowed;
}

.composer__btn--stop {
  background: var(--danger);
}

.composer__btn--stop:hover {
  background: #c93737;
}

.composer__hint {
  max-width: 780px;
  margin: 8px auto 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-muted);
}

/* ════════ Modal ════════ */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal {
  /* 從 440 加寬到 500;設定彈窗內容變多後 440 太擁擠 */
  width: min(500px, 92vw);
  background: var(--bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.modal--lg {
  width: min(640px, 92vw);
}

.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.modal__head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.x-btn {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
}

.x-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.modal__body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* select 沿用 field__input 視覺,但保留原生下拉箭頭 */
select.field__input {
  cursor: pointer;
  appearance: auto;
}

/* ─── Settings modal 分區 ─── */
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.settings-section:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.settings-section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.settings-section__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.settings-section__hint {
  font-size: 11.5px;
  color: var(--text-muted);
}

/* ─── Provider 選擇 + 添加 / 刪除按鈕 ─── */
.provider-bar {
  display: flex;
  gap: 6px;
  align-items: center;
}

.provider-bar__select {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 13.5px;
  background: var(--bg);
  color: var(--text);
  outline: none;
  cursor: pointer;
}

.provider-bar__select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

/* 通用 icon 按鈕(+ / 🗑 / ↻) — 32×32,正方形 */
.icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.icon-btn--danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: #fef2f2;
}

.icon-btn.loading svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ─── Model 下拉 + ↻ 按鈕一行 ─── */
.model-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.model-row__select {
  flex: 1;
}

/* ─── 開關樣式(checkbox) ─── */
.switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch__track {
  width: 36px;
  height: 20px;
  background: var(--border-strong);
  border-radius: 999px;
  position: relative;
  transition: background 0.18s;
  flex-shrink: 0;
}

.switch__track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.18s;
}

.switch input:checked + .switch__track {
  background: var(--accent);
}

.switch input:checked + .switch__track::after {
  transform: translateX(16px);
}

.switch__label {
  font-size: 13.5px;
  color: var(--text);
}

.field__label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field__input {
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 13.5px;
  font-family: var(--font);
  color: var(--text);
  background: var(--bg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.field__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

.field__hint {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

.prompt-area {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
  background: var(--bg);
  resize: vertical;
  outline: none;
  line-height: 1.6;
}

.prompt-area:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

.btn-primary {
  padding: 8px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.modal__foot .btn-ghost {
  width: auto;
  padding: 8px 14px;
}

/* overlay transitions */
.overlay-enter-from, .overlay-leave-to {
  opacity: 0;
}

.overlay-enter-active, .overlay-leave-active {
  transition: opacity 0.18s;
}

.overlay-enter-active .modal, .overlay-leave-active .modal {
  transition: transform 0.18s;
}

.overlay-enter-from .modal {
  transform: translateY(8px) scale(0.98);
}

.overlay-leave-to .modal {
  transform: translateY(8px) scale(0.98);
}
</style>
