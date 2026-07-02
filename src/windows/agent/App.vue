<!--
  AI Agent 獨立窗主介面(docs/19,Stage 1)。

  左:對話列表(新建 / 切換 / 刪除)。右:訊息串 + 輸入。
  串流:訂閱 AGENT_PUSH_*,delta 累積到當前 assistant 氣泡(Stage 1 用響應式;
  §3.2 的 vanilla controller 熱路徑優化留 Stage 4)。
  未配置模型:頂部橫幅引導去主視窗「模型設定」。
-->
<template>
  <div class="agent-app">
    <!-- 左:對話列表 -->
    <aside class="side">
      <el-button :icon="Plus" class="new-btn" type="primary" @click="newChat">新對話</el-button>
      <el-scrollbar class="conv-list">
        <div
            v-for="c in conversations"
            :key="c.conversationId"
            :class="{active: c.conversationId === activeConvId}"
            class="conv-item"
            @click="selectConversation(c.conversationId)"
        >
          <span class="conv-title">{{ c.title }}</span>
          <el-icon class="conv-del" @click.stop="removeConversation(c.conversationId)">
            <Delete/>
          </el-icon>
        </div>
        <div v-if="!conversations.length" class="conv-empty">還沒有對話</div>
      </el-scrollbar>
    </aside>

    <!-- 右:對話區 -->
    <main class="chat">
      <div v-if="!ready" class="banner">
        ⚠️ 尚未配置模型 —— 請到主視窗的「模型設定」配置 provider(URL + model),再回來重開此窗。
      </div>

      <!-- 原生滾動容器(不用 el-scrollbar):往上滾觸發懶加載更舊訊息 -->
      <div ref="scrollEl" class="msg-scroll" @scroll="onScroll">
        <div v-if="loadingMore" class="load-more">載入更早的訊息…</div>
        <div class="msg-wrap">
          <div v-for="m in messages" :key="m.id" :class="`msg--${m.kind}`" class="msg">
            <!-- 使用者 / 助理 氣泡 -->
            <template v-if="m.kind === 'user' || m.kind === 'assistant'">
              <div class="bubble">
                <div v-if="m.reasoning" class="reasoning-box">
                  <button class="reasoning-toggle" type="button" @click="m.reasoningOpen = !m.reasoningOpen">
                    <el-icon :size="12">
                      <component :is="m.reasoningOpen ? ArrowDown : ArrowRight"/>
                    </el-icon>
                    思考過程{{ m.reasoningOpen ? '' : '(點擊展開)' }}
                  </button>
                  <div v-show="m.reasoningOpen" class="reasoning">{{ m.reasoning }}</div>
                </div>
                <!-- assistant 完成後渲染 markdown;串流中 / user 用純文字 -->
                <div v-if="m.kind === 'assistant' && !m.streaming" class="content markdown" v-html="render(m.content)"/>
                <div v-else class="content">{{ m.content }}<span v-if="m.streaming" class="caret">▋</span></div>
              </div>
            </template>
            <!-- 工具卡:預設折疊,只顯示一行摘要;點擊展開看 input/output -->
            <div v-else-if="m.kind === 'tool'" class="tool-card">
              <button class="tool-head" type="button" @click="m.open = !m.open">
                <el-icon :size="12" class="tool-chevron">
                  <component :is="m.open ? ArrowDown : ArrowRight"/>
                </el-icon>
                <el-icon>
                  <Tools/>
                </el-icon>
                <b>{{ m.name }}</b>
                <el-tag v-if="m.running" size="small" type="info">執行中</el-tag>
                <el-tag v-else-if="m.isError" size="small" type="danger">失敗</el-tag>
                <el-tag v-else size="small" type="success">完成</el-tag>
              </button>
              <template v-if="m.open">
                <pre class="tool-io">{{ shorten(stringify(m.input)) }}</pre>
                <pre v-if="m.output !== undefined" class="tool-io out">{{ shorten(stringify(m.output)) }}</pre>
              </template>
            </div>
          </div>
          <div v-if="!messages.length" class="chat-empty">開始跟 AI 對話吧</div>
        </div>
      </div>

      <!-- 輸入 -->
      <div class="input-bar">
        <el-input
            v-model="input"
            :autosize="{minRows: 1, maxRows: 6}"
            :disabled="!ready"
            placeholder="輸入訊息…(Enter 送出,Shift+Enter 換行)"
            type="textarea"
            @keydown.enter.exact.prevent="send"
        />
        <el-button v-if="!sending" :disabled="!ready || !input.trim()" :icon="Promotion" type="primary" @click="send">
          送出
        </el-button>
        <el-button v-else :icon="CircleClose" type="danger" @click="stop">停止</el-button>
      </div>
    </main>
  </div>
</template>

<script lang="ts" setup>
import {nextTick, onMounted, onUnmounted, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {ArrowDown, ArrowRight, CircleClose, Delete, Plus, Promotion, Tools} from '@element-plus/icons-vue'
import {IpcChannels} from '@shared/ipc-channels'
import type {ConversationSummary} from '@shared/types/agent.types'
import {renderMarkdown as render} from './markdown'

// ── 視圖訊息(union) ──
interface ChatMsg {
  id: string
  kind: 'user' | 'assistant'
  content: string
  reasoning?: string
  /** think 內容預設折疊,點擊展開 */
  reasoningOpen?: boolean
  streaming?: boolean
}

interface ToolMsg {
  id: string // = toolUseId
  kind: 'tool'
  name: string
  input: unknown
  output?: unknown
  isError?: boolean
  running?: boolean
  /** 預設折疊,點擊展開看 input/output */
  open?: boolean
}

type ViewMsg = ChatMsg | ToolMsg

const api = () => window.electronAPI.agent

const ready = ref(false)
const conversations = ref<ConversationSummary[]>([])
const activeConvId = ref<string>('')
const messages = ref<ViewMsg[]>([])
const input = ref('')
const sending = ref(false)
const scrollEl = ref<HTMLDivElement | null>(null)

// ── 懶加載:先載最近 PAGE 則,往上滾再載更舊(上下文長也不卡)──
const PAGE = 30
let oldestTs: number | null = null
const hasMore = ref(false)
const loadingMore = ref(false)

/** DB 訊息行 → 視圖(只顯示 user/assistant;工具卡只在當輪即時渲,不從歷史重建) */
interface RawRow {
  id: string
  role: string
  content: string
  reasoningContent?: string
  timestamp: number
}

function mapRows(rows: RawRow[]): ViewMsg[] {
  return rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .map((r) => ({id: r.id, kind: r.role as 'user' | 'assistant', content: r.content, reasoning: r.reasoningContent}))
}

// ── envelope 解包 ──
async function call<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p
  if (r.ok) return r.data
  throw new Error(r.error)
}

// ── 載入 ──
async function loadConfig() {
  try {
    const cfg = await call<{ isReady: boolean }>(api().configRead())
    ready.value = !!cfg.isReady
  } catch {
    ready.value = false
  }
}

async function loadConversations() {
  try {
    conversations.value = await call<ConversationSummary[]>(api().listConversations())
  } catch {
    conversations.value = []
  }
}

async function selectConversation(id: string) {
  activeConvId.value = id
  try {
    const rows = await call<RawRow[]>(api().listMessages(id, PAGE))
    messages.value = mapRows(rows)
    oldestTs = rows.length ? rows[0].timestamp : null
    hasMore.value = rows.length >= PAGE
    scrollBottom()
  } catch {
    messages.value = []
    hasMore.value = false
  }
}

/** 往上滾到頂 → 載更舊一頁,並補回 scrollTop 保持視覺位置 */
async function loadOlder() {
  if (loadingMore.value || !hasMore.value || oldestTs == null || !activeConvId.value) return
  const el = scrollEl.value
  if (!el) return
  loadingMore.value = true
  const prevH = el.scrollHeight
  const prevTop = el.scrollTop
  try {
    const rows = await call<RawRow[]>(api().listMessages(activeConvId.value, PAGE, oldestTs))
    if (rows.length) {
      oldestTs = rows[0].timestamp
      hasMore.value = rows.length >= PAGE
      messages.value = [...mapRows(rows), ...messages.value]
      await nextTick()
      el.scrollTop = el.scrollHeight - prevH + prevTop
    } else {
      hasMore.value = false
    }
  } catch {
    hasMore.value = false
  } finally {
    loadingMore.value = false
  }
}

function onScroll() {
  const el = scrollEl.value
  if (el && el.scrollTop < 60) void loadOlder()
}

async function newChat() {
  try {
    const {conversationId} = await call<{ conversationId: string }>(api().newConversation())
    activeConvId.value = conversationId
    messages.value = []
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function removeConversation(id: string) {
  try {
    await call(api().deleteConversation(id))
    if (id === activeConvId.value) {
      activeConvId.value = ''
      messages.value = []
    }
    await loadConversations()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ── 送出 / 停止 ──
async function send() {
  const text = input.value.trim()
  if (!text || !ready.value || sending.value) return
  if (!activeConvId.value) await newChat()
  input.value = ''
  sending.value = true
  messages.value.push({id: `u-${Date.now()}`, kind: 'user', content: text})
  scrollBottom()
  try {
    const r = await call<{ messageId: string; conversationId: string }>(
        api().start(activeConvId.value, text))
    activeConvId.value = r.conversationId
    // 預建 assistant 氣泡(串流 delta 會找這個 id 累積)
    ensureAssistant(r.messageId)
    await loadConversations()
  } catch (err) {
    sending.value = false
    ElMessage.error((err as Error).message)
  }
}

function stop() {
  api().interrupt(activeConvId.value)
  sending.value = false
}

// ── 串流事件 ──
function ensureAssistant(id: string): ChatMsg {
  const found = messages.value.find((m) => m.id === id && m.kind === 'assistant') as ChatMsg | undefined
  if (found) return found
  const msg: ChatMsg = {id, kind: 'assistant', content: '', reasoning: '', streaming: true}
  messages.value.push(msg)
  return msg
}

function onStream(...args: unknown[]) {
  const p = args[0] as { conversationId: string; messageId: string; kind: 'text' | 'thinking'; delta: string }
  if (p.conversationId !== activeConvId.value) return
  const m = ensureAssistant(p.messageId)
  if (p.kind === 'thinking') m.reasoning = (m.reasoning ?? '') + p.delta
  else m.content += p.delta
  scrollBottom()
}

function onToolUse(...args: unknown[]) {
  const p = args[0] as { conversationId: string; toolUseId: string; name: string; input: unknown }
  if (p.conversationId !== activeConvId.value) return
  messages.value.push({id: p.toolUseId, kind: 'tool', name: p.name, input: p.input, running: true})
  scrollBottom()
}

function onToolResult(...args: unknown[]) {
  const p = args[0] as { conversationId: string; toolUseId: string; content: unknown; isError: boolean }
  if (p.conversationId !== activeConvId.value) return
  const t = messages.value.find((m) => m.id === p.toolUseId && m.kind === 'tool') as ToolMsg | undefined
  if (t) {
    t.output = p.content
    t.isError = p.isError
    t.running = false
  }
  scrollBottom()
}

function onEnd(...args: unknown[]) {
  const p = args[0] as { conversationId: string; messageId: string }
  if (p.conversationId !== activeConvId.value) return
  const m = messages.value.find((x) => x.id === p.messageId && x.kind === 'assistant') as ChatMsg | undefined
  if (m) m.streaming = false
  sending.value = false
}

function onError(...args: unknown[]) {
  const p = args[0] as { conversationId: string; message: string }
  sending.value = false
  ElMessage.error(p.message)
}

// ── 工具函式 ──
function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function shorten(s: string, max = 800): string {
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s
}

function scrollBottom() {
  void nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// ── 生命週期 ──
const C = IpcChannels
onMounted(async () => {
  window.electronAPI.on(C.AGENT_PUSH_STREAM, onStream)
  window.electronAPI.on(C.AGENT_PUSH_TOOL_USE, onToolUse)
  window.electronAPI.on(C.AGENT_PUSH_TOOL_RESULT, onToolResult)
  window.electronAPI.on(C.AGENT_PUSH_END, onEnd)
  window.electronAPI.on(C.AGENT_PUSH_ERROR, onError)
  await loadConfig()
  await loadConversations()
  if (conversations.value.length) await selectConversation(conversations.value[0].conversationId)
  else await newChat()
})

onUnmounted(() => {
  window.electronAPI.off(C.AGENT_PUSH_STREAM, onStream)
  window.electronAPI.off(C.AGENT_PUSH_TOOL_USE, onToolUse)
  window.electronAPI.off(C.AGENT_PUSH_TOOL_RESULT, onToolResult)
  window.electronAPI.off(C.AGENT_PUSH_END, onEnd)
  window.electronAPI.off(C.AGENT_PUSH_ERROR, onError)
})
</script>

<!-- 非 scoped:鎖死根容器高度,消除視窗層的第二條滾動條(只留訊息區內部滾動) -->
<style>
html,
body,
#agent-app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>

<style scoped>
.agent-app {
  display: flex;
  height: 100%;
  background: #fafbfc;
  color: #303133;
  font-size: 14px;
}

/* 左側對話列表 */
.side {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.new-btn {
  width: 100%;
  margin-bottom: 10px;
}

.conv-list {
  flex: 1;
  min-height: 0;
}

.conv-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
}

.conv-item:hover {
  background: #f2f3f5;
}

.conv-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.conv-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-del {
  opacity: 0;
  color: #c0c4cc;
}

.conv-item:hover .conv-del {
  opacity: 1;
}

.conv-del:hover {
  color: #f56c6c;
}

.conv-empty {
  color: #909399;
  font-size: 12px;
  text-align: center;
  margin-top: 20px;
}

/* 右側對話區 */
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.banner {
  background: #fdf6ec;
  color: #b88230;
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid #faecd8;
}

.msg-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 原生滾軸(細但可見);不用 el-scrollbar,方便懶加載偵測 scrollTop */
.msg-scroll::-webkit-scrollbar {
  width: 10px;
}

.msg-scroll::-webkit-scrollbar-thumb {
  background: #c8ccd4;
  border-radius: 5px;
  border: 2px solid #fafbfc;
}

.msg-scroll::-webkit-scrollbar-thumb:hover {
  background: #a6abb5;
}

.load-more {
  text-align: center;
  color: #909399;
  font-size: 12px;
  padding: 8px 0;
}

.msg-wrap {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.msg {
  display: flex;
}

.msg--user {
  justify-content: flex-end;
}

.msg--assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 10px;
  line-height: 1.6;
}

.msg--user .bubble {
  background: #409eff;
  color: #fff;
}

.msg--assistant .bubble {
  background: #fff;
  border: 1px solid #e4e7ed;
}

.content {
  white-space: pre-wrap;
  word-break: break-word;
}

.reasoning-box {
  margin-bottom: 8px;
}

.reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: #909399;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.reasoning-toggle:hover {
  color: #606266;
}

.reasoning {
  color: #909399;
  font-size: 12.5px;
  white-space: pre-wrap;
  border-left: 2px solid #dcdfe6;
  padding-left: 8px;
  margin-top: 6px;
}

/* markdown 渲染內容(assistant 完成後) */
.markdown {
  white-space: normal;
  line-height: 1.7;
}

.markdown :deep(p) {
  margin: 0 0 8px;
}

.markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown :deep(pre.hljs) {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 12.5px;
  margin: 8px 0;
}

.markdown :deep(code) {
  font-family: 'Consolas', 'Courier New', monospace;
}

.markdown :deep(:not(pre) > code) {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12.5px;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 4px 0;
  padding-left: 22px;
}

.markdown :deep(a) {
  color: #409eff;
}

.markdown :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}

.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 4px 8px;
}

.caret {
  color: #409eff;
  animation: blink 1s step-start infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* 工具卡 */
.tool-card {
  width: 100%;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-left: 3px solid #a0cfff;
  border-radius: 8px;
  padding: 8px 12px;
}

.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  text-align: left;
  color: inherit;
}

.tool-chevron {
  color: #909399;
}

.tool-io {
  margin: 6px 0 0;
  padding: 8px;
  background: #f6f8fa;
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
}

.tool-io.out {
  background: #f0f9eb;
}

.chat-empty {
  color: #909399;
  text-align: center;
  margin-top: 40px;
}

/* 輸入列 */
.input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e4e7ed;
  background: #fff;
  align-items: flex-end;
}

.input-bar .el-textarea {
  flex: 1;
}
</style>
