<script lang="ts" setup>
/**
 * Agent 窗口左側對話列表 — ChatGPT 風格。
 *
 * 內部只負責 UI + 時間格式化;對話增刪 / 切換由 emit 給父層,父層去呼叫 store / IPC。
 * hover 顯示刪除按鈕,點擊整列切換對話。
 */
import type {ConversationSummary} from '../types'

defineProps<{
  conversations: ConversationSummary[]
  activeConversationId: string | null
}>()

const emit = defineEmits<{
  (e: 'new-conversation'): void
  (e: 'select-conversation', c: ConversationSummary): void
  (e: 'delete-conversation', c: ConversationSummary, ev: Event): void
  (e: 'open-prompt'): void
  (e: 'open-settings'): void
}>()

/** 列表時間顯示:今天 HH:mm,昨天「昨天」,更早 M/D */
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
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__head">
      <button class="btn-new" @click="emit('new-conversation')">
        <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
             stroke-width="2" viewBox="0 0 24 24" width="16">
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
         - <button> 內按規範只能放 phrasing content,div / 嵌套 button 都會觸發 IDE 警告
         - 嵌套 button 在某些瀏覽器會把點擊事件吞掉
        delete 按鈕保留 button 語意(只觸發刪除,不觸發整列選取)
      -->
      <div
          v-for="c in conversations"
          :key="c.conversationId"
          :class="{'is-active': c.conversationId === activeConversationId}"
          class="convo"
          role="button"
          tabindex="0"
          @click="emit('select-conversation', c)"
          @keydown.enter="emit('select-conversation', c)"
          @keydown.space.prevent="emit('select-conversation', c)"
      >
        <span class="convo__main">
          <span class="convo__title">{{ c.title }}</span>
          <span class="convo__meta">
            <span>{{ formatTime(c.lastTime) }}</span>
            <span class="dot">·</span>
            <span>{{ c.messageCount }} 則</span>
          </span>
        </span>
        <button class="convo__del" title="刪除對話" @click="emit('delete-conversation', c, $event)">
          <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
               stroke-width="2" viewBox="0 0 24 24" width="14">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="sidebar__foot">
      <button class="btn-ghost" @click="emit('open-prompt')">
        <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
             stroke-width="2" viewBox="0 0 24 24" width="14">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>System Prompt</span>
      </button>
      <button class="btn-ghost" @click="emit('open-settings')">
        <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
             stroke-width="2" viewBox="0 0 24 24" width="14">
          <circle cx="12" cy="12" r="3"/>
          <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>設定</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
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
</style>
