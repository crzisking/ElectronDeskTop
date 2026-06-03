<script lang="ts" setup>
/**
 * Agent 對話訊息流。
 *
 * 內含:
 *  - 空態歡迎頁(含 4 個範例按鈕,點擊塞入 input 並 emit pick-example)
 *  - 訊息列表(v-for + v-memo;對 doc 17 §1.1 / §9)
 *  - 錯誤紅條
 *  - 自動滾到底:watch messages.length + 文字長度變化,nextTick 後雙 RAF 滾
 */
import {nextTick, ref, watch} from 'vue'
import ChatMessage from './ChatMessage.vue'
import type {AgentMessage} from '../types'

const props = defineProps<{
  messages: AgentMessage[]
  /** 'idle' | 'running' | 'error' 等;'error' 顯示底部紅條 */
  status: string
  errorMessage: string
  /** active provider 是否就緒(沒就緒時歡迎頁底部出警告) */
  isReady: boolean
}>()

const emit = defineEmits<{
  /** 範例卡片被點 → 父層把該 text 塞進輸入框 */
  (e: 'pick-example', text: string): void
}>()

const listRef = ref<HTMLElement | null>(null)

/**
 * 兩次 RAF:確保 markdown 渲染 / CodeBlock upgrade 後重排完成才滾。
 */
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

watch(() => props.messages.length, () => nextTick(() => scrollToBottom()))
watch(
    () => props.messages.map((m) => m.content?.length ?? 0).join('|'),
    () => nextTick(() => scrollToBottom()),
)

/** 父層切換歷史對話後手動呼叫,跳到底部 */
defineExpose({scrollToBottom})

const examples = [
  {title: '打開記事本', hint: 'open_app("notepad")', input: '幫我打開記事本'},
  {title: '擷取螢幕', hint: 'screenshot()', input: '幫我截一張當前螢幕的圖'},
  {title: '列出檔案', hint: 'list_files("C:\\Windows")', input: '列出 C:\\Windows 目錄下的檔案'},
  {title: '讀取剪貼簿', hint: 'clipboard_read()', input: '把剪貼簿的內容讀出來給我看'},
]
</script>

<template>
  <main ref="listRef" class="thread">
    <!-- 空狀態 -->
    <div v-if="messages.length === 0" class="welcome">
      <div class="welcome__logo">
        <svg fill="none" height="32" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
             stroke-width="1.6" viewBox="0 0 24 24" width="32">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="4"/>
        </svg>
      </div>
      <h2>有什麼可以幫忙的嗎?</h2>
      <p>我可以開啟程式、讀寫檔案、執行命令、截取螢幕、操作剪貼簿。</p>

      <div class="example-grid">
        <button
            v-for="ex in examples"
            :key="ex.title"
            class="example"
            @click="emit('pick-example', ex.input)"
        >
          <span class="example__title">{{ ex.title }}</span>
          <span class="example__hint">{{ ex.hint }}</span>
        </button>
      </div>

      <div v-if="!isReady" class="warn-banner">
        ⚠ 請先到左下角「設定」配置 LLM 廠商(填 API Key + 選 model)
      </div>
    </div>

    <!--
      訊息列表:純 v-for + v-memo,單對話 < 200 則完全夠用。
      v-memo 鎖在 [id, content, streaming, toolCalls 長度, reasoningContent]:
      streaming 中那條每幀 invalidate,其它條全 skip。
    -->
    <div v-else class="msgs">
      <ChatMessage
          v-for="m in messages"
          :key="m.id"
          v-memo="[m.id, m.content, m.streaming, m.toolCalls?.length ?? 0, m.reasoningContent]"
          :message="m"
      />
      <div v-if="status === 'error'" class="error-line">
        ⚠ {{ errorMessage }}
      </div>
    </div>
  </main>
</template>

<style scoped>
.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.msgs {
  max-width: 780px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 24px 80px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

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
</style>
