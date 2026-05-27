<script lang="ts" setup>
/**
 * ChatMessage — 單則訊息容器(對應 doc 17 §14.3)。
 *
 * 職責:
 *   - 渲染 avatar / author 名稱
 *   - 從 store 索引出本訊息相關的 tool results(O(1) Map 查)
 *   - 把 message 拆成 blocks,逐一交給 MessageRenderer 路由
 *   - 流式中 / 末尾顯示打字機游標
 *
 * 為什麼把 toolResults 計算放這裡,不放 store:
 *   - 不是所有訊息都需要;只在當前 message 是 assistant 且有 toolCalls 時才掃描
 *   - store 端持有平鋪的 messages 即可,結構轉換留在 view 層
 */
import {computed} from 'vue'
import {useAgentStore} from '../store'
import {parseBlocks} from '../composables/parse-blocks'
import MessageRenderer from './MessageRenderer.vue'
import type {AgentMessage, ToolResult} from '../types'

const props = defineProps<{ message: AgentMessage }>()

const store = useAgentStore()

/** toolCallId → ToolResult 索引;遍歷整個 messages O(n),但只在有 toolCalls 時觸發 */
const toolResults = computed<Map<string, ToolResult>>(() => {
  const map = new Map<string, ToolResult>()
  if (props.message.role !== 'assistant' || !props.message.toolCalls?.length) {
    return map
  }
  for (const m of store.messages) {
    if (m.role === 'tool' && m.toolCallId && m.toolDisplay) {
      map.set(m.toolCallId, m.toolDisplay)
    }
  }
  return map
})

const blocks = computed(() => parseBlocks(props.message, toolResults.value))

const isUser = computed(() => props.message.role === 'user')

const showCursor = computed(
    () => props.message.streaming && !props.message.toolCalls?.length,
)
</script>

<template>
  <article :class="`msg--${message.role}`" class="msg">
    <div class="msg__avatar">
      <template v-if="isUser">您</template>
      <svg
          v-else
          fill="none" height="14" stroke="currentColor"
          stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          viewBox="0 0 24 24" width="14"
      >
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" fill="currentColor" r="3"/>
      </svg>
    </div>

    <div class="msg__body">
      <div class="msg__author">{{ isUser ? '您' : 'AI Agent' }}</div>
      <MessageRenderer
          v-for="(block, i) in blocks"
          :key="i"
          :block="block"
          :streaming="message.streaming"
      />
      <span v-if="showCursor" class="cursor">▍</span>
    </div>
  </article>
</template>

<style scoped>
.msg {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.msg__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 2px;
}

.msg--user .msg__avatar {
  background: #5b8def;
  color: #fff;
}

.msg--assistant .msg__avatar {
  background: var(--accent);
  color: #fff;
}

.msg__body {
  flex: 1;
  min-width: 0;
}

.msg__author {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.cursor {
  display: inline-block;
  width: 6px;
  height: 16px;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 1s steps(2) infinite;
}

@keyframes blink {
  to {
    opacity: 0;
  }
}
</style>
