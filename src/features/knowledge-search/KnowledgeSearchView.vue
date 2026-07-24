<script lang="ts" setup>
/**
 * 知識檢索 — 單一知識庫的 Agent 問答頁(個人功能入口)。
 *
 * 薄殼:選庫 + 對話面板,邏輯全在 useKnowledgeChat。
 *  - 進頁載入該工號可見的知識庫(選庫下拉只列有權的,選了不會被平台 403)。
 *  - 提問走平台 /chat/kb/stream 串流,逐字打字機 + 引用來源(點擊用系統瀏覽器開 MinIO 原件)。
 *  - RAG / Agent 全在後端,桌面只發問、持有 history、渲染(見 docs/24)。
 */

import {nextTick, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {ArrowLeft, ChatDotRound, Document as DocIcon, Promotion, RefreshRight} from '@element-plus/icons-vue'
import {useKnowledgeChat} from './composables/useKnowledgeChat'
import {renderMarkdown} from './markdown'
import type {SourceOut} from './types'

const router = useRouter()

/** 返回:優先還原來時路徑(router.back);無歷史可回時兜底到個人功能頁。 */
function goBack(): void {
  if (window.history.length > 1) router.back()
  else router.push({name: 'personal-functions'}).catch(() => undefined)
}

const {
  kbs,
  selectedKbCode,
  kbsLoading,
  messages,
  sending,
  canSend,
  loadKbs,
  send,
  newConversation,
  dispose,
} = useKnowledgeChat()

/** 輸入框內容(本地,送出後清空)。 */
const draft = ref('')
/** 訊息滾動容器,收到新內容時自動滾到底。 */
const scrollRef = ref<HTMLElement | null>(null)

onMounted(loadKbs)
onUnmounted(dispose)

/** 送出:非空且可送才發,發完清空輸入框。 */
async function handleSend(): Promise<void> {
  const text = draft.value.trim()
  if (!text || !canSend.value) return
  draft.value = ''
  await send(text)
}

/** Enter 送出、Shift+Enter 換行。el-input 的 keydown 型別是 Event | KeyboardEvent,先收窄。 */
function onKeydown(e: Event | KeyboardEvent): void {
  if (!(e instanceof KeyboardEvent)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void handleSend()
  }
}

/** 切庫時提示會另開新對話(不同庫的歷史不該混)。 */
watch(selectedKbCode, (next, prev) => {
  if (prev && next && next !== prev && messages.value.length > 0) {
    newConversation()
  }
})

/** 用系統瀏覽器打開來源原件(window.open 被 setWindowOpenHandler 轉 shell.openExternal)。 */
function openSource(source: SourceOut): void {
  if (source.download_url) window.open(source.download_url, '_blank')
}

/** 訊息變化(含串流逐字)後滾到底,讓最新內容始終可見。 */
watch(
    messages,
    async () => {
      await nextTick()
      const el = scrollRef.value
      if (el) el.scrollTop = el.scrollHeight
    },
    {deep: true},
)
</script>

<template>
  <div class="app-page knowledge-search-view">
    <!-- ── 頁首:標題 + 選庫 + 新對話 ──────────────────────── -->
    <div class="app-page-header app-page-header--compact ks-header">
      <div class="app-page-header__left">
        <el-button :icon="ArrowLeft" class="ks-back-btn" plain size="small" @click="goBack">
          返回
        </el-button>
        <h1 class="page-title">知識檢索</h1>
        <p class="page-subtitle">選一個知識庫,用自然語言提問,答案帶引用來源</p>
      </div>
      <div class="ks-header__actions">
        <el-select
            v-model="selectedKbCode"
            :loading="kbsLoading"
            class="ks-kb-select"
            placeholder="選擇知識庫"
        >
          <el-option v-for="kb in kbs" :key="kb.code" :label="kb.name" :value="kb.code"/>
        </el-select>
        <el-button :disabled="sending && messages.length === 0" :icon="RefreshRight" @click="newConversation">
          新對話
        </el-button>
      </div>
    </div>

    <!-- ── 對話區 ─────────────────────────────────────────── -->
    <div ref="scrollRef" class="ks-messages">
      <!-- 空狀態:引導選庫提問 -->
      <div v-if="messages.length === 0" class="ks-empty">
        <el-icon class="ks-empty__icon">
          <ChatDotRound/>
        </el-icon>
        <p v-if="kbs.length === 0 && !kbsLoading" class="ks-empty__text">
          你目前沒有可訪問的知識庫
        </p>
        <p v-else class="ks-empty__text">在下方輸入問題,開始向「{{ selectedKbCode || '所選知識庫' }}」提問</p>
      </div>

      <!-- 訊息泡泡 -->
      <div
          v-for="(msg, idx) in messages"
          :key="idx"
          :class="['ks-msg', `ks-msg--${msg.role}`]"
      >
        <div class="ks-msg__bubble">
          <!-- 助手訊息:markdown 渲染(renderMarkdown 已 html:false 防注入,見 markdown.ts) -->
          <!-- 串流剛開始、還沒有任何 token 時,顯示明顯的「檢索中」動畫,而非空泡泡 -->
          <div v-if="msg.role === 'assistant' && msg.streaming && !msg.content" class="ks-typing">
            <span class="ks-typing__label">檢索中</span>
            <span class="ks-typing__dots"><i/><i/><i/></span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 用 markdown-it html:false,不輸出 raw HTML -->
          <div v-else-if="msg.role === 'assistant'" class="ks-markdown" v-html="renderMarkdown(msg.content)"/>
          <!-- 使用者訊息:原樣純文字(自己輸入的,不需 markdown) -->
          <span v-else class="ks-msg__content">{{ msg.content }}</span>

          <!-- 串流中且已有內容時,末尾接一個閃爍游標 -->
          <span v-if="msg.streaming && msg.content" class="ks-cursor"/>

          <!-- 引用來源(助手訊息答完後) -->
          <div v-if="msg.sources && msg.sources.length > 0" class="ks-sources">
            <div class="ks-sources__title">引用來源</div>
            <a
                v-for="src in msg.sources"
                :key="src.document_id"
                class="ks-source"
                @click="openSource(src)"
            >
              <el-icon>
                <DocIcon/>
              </el-icon>
              <span class="ks-source__name">{{ src.document_name }}</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 輸入區 ─────────────────────────────────────────── -->
    <div class="ks-input">
      <el-input
          v-model="draft"
          :autosize="{minRows: 1, maxRows: 5}"
          :disabled="!selectedKbCode"
          placeholder="輸入問題,Enter 送出、Shift+Enter 換行"
          resize="none"
          type="textarea"
          @keydown="onKeydown"
      />
      <el-button
          :disabled="!canSend || !draft.trim()"
          :icon="Promotion"
          :loading="sending"
          type="primary"
          @click="handleSend"
      >
        送出
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.knowledge-search-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* header__left 是 flex column(align-items:stretch),按鈕不設 align-self 會被拉成整列寬 */
.ks-back-btn {
  align-self: flex-start;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--app-text-primary);
  letter-spacing: -0.01em;
}

.page-subtitle {
  margin: 6px 0 0 0;
  font-size: 14px;
  color: var(--app-text-secondary);
}

.ks-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.ks-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.ks-kb-select {
  width: 200px;
}

/* 對話區:占滿剩餘高度、可滾動 */
.ks-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ks-empty {
  margin: auto;
  text-align: center;
  color: var(--app-text-secondary);
}

.ks-empty__icon {
  font-size: 48px;
  opacity: 0.4;
}

.ks-empty__text {
  margin-top: 12px;
  font-size: 14px;
}

.ks-msg {
  display: flex;
}

.ks-msg--user {
  justify-content: flex-end;
}

.ks-msg--assistant {
  justify-content: flex-start;
}

.ks-msg__bubble {
  max-width: 76%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

/* 純文字(使用者訊息)保留換行;markdown 區塊由自身標籤排版,不吃 pre-wrap */
.ks-msg__content {
  white-space: pre-wrap;
}

.ks-msg--user .ks-msg__bubble {
  background: var(--el-color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.ks-msg--assistant .ks-msg__bubble {
  background: var(--app-bg-elevated, var(--el-fill-color-light));
  color: var(--app-text-primary);
  border-bottom-left-radius: 4px;
}

/* 「檢索中」動畫:文字 + 三顆依序跳動的點,比單一游標明顯得多 */
.ks-typing {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-secondary);
  font-size: 14px;
}

.ks-typing__dots {
  display: inline-flex;
  gap: 4px;
}

.ks-typing__dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  opacity: 0.4;
  animation: ks-bounce 1.2s infinite ease-in-out;
}

.ks-typing__dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.ks-typing__dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes ks-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* 全域 body 設了 user-select:none,對話文字會繼承而無法複製;
   這裡把答案(markdown)與使用者提問重新開放成可選取,方便框選複製。 */
.ks-markdown,
.ks-msg__content {
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

/* markdown 渲染區:壓掉外距、給程式碼 / 表格 / 引用基本樣式 */
.ks-markdown {
  font-size: 14px;
  line-height: 1.6;
}

.ks-markdown :deep(p) {
  margin: 0 0 8px;
}

.ks-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.ks-markdown :deep(ul),
.ks-markdown :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 20px;
}

.ks-markdown :deep(h1),
.ks-markdown :deep(h2),
.ks-markdown :deep(h3),
.ks-markdown :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}

.ks-markdown :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--el-fill-color);
  font-family: var(--app-font-mono);
  font-size: 0.92em;
}

.ks-markdown :deep(pre) {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.ks-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
}

.ks-markdown :deep(blockquote) {
  margin: 8px 0;
  padding-left: 10px;
  border-left: 3px solid var(--el-border-color);
  color: var(--app-text-secondary);
}

.ks-markdown :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.ks-markdown :deep(th),
.ks-markdown :deep(td) {
  border: 1px solid var(--el-border-color-lighter);
  padding: 4px 8px;
}

.ks-markdown :deep(a) {
  color: var(--el-color-primary);
}

/* 串流游標:閃爍豎線 */
.ks-cursor {
  display: inline-block;
  width: 6px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: currentColor;
  opacity: 0.6;
  animation: ks-blink 1s step-start infinite;
}

@keyframes ks-blink {
  50% {
    opacity: 0;
  }
}

/* 引用來源 */
.ks-sources {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.ks-sources__title {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin-bottom: 6px;
}

.ks-source {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 13px;
  color: var(--el-color-primary);
  cursor: pointer;
}

.ks-source:hover {
  text-decoration: underline;
}

.ks-source__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 輸入區 */
.ks-input {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.ks-input .el-textarea {
  flex: 1;
}
</style>
