<script lang="ts" setup>
/**
 * MessageRenderer — block 路由(對應 doc 17 §8.1)。
 *
 * 把單一 MessageBlock 分發給對應的渲染元件。新增 block type 時:
 *   1. 在 `types.ts` 的 MessageBlock union 加成員
 *   2. 在 `parse-blocks.ts` 加產出邏輯
 *   3. 在這裡加 v-else-if + import 對應元件
 *
 * 目前路由的 block:
 *   - text:走 MarkdownRenderer
 *   - tool_call:走 ToolCallCard
 *
 * 預留(P2 啟用):thinking / citation / mermaid / file。
 */
import type {MessageBlock} from '../types'
import MarkdownRenderer from './MarkdownRenderer.vue'
import ToolCallCard from './ToolCallCard.vue'
import ThinkingBlock from './ThinkingBlock.vue'

defineProps<{
  block: MessageBlock
  /** streaming 狀態透傳給 MarkdownRenderer,讓它決定要不要 upgrade CodeBlock */
  streaming?: boolean
}>()
</script>

<template>
  <MarkdownRenderer
      v-if="block.type === 'text'"
      :source="block.content"
      :streaming="streaming"
  />
  <ToolCallCard
      v-else-if="block.type === 'tool_call'"
      :result="block.result"
      :tool-call="block.toolCall"
  />
  <ThinkingBlock
      v-else-if="block.type === 'thinking'"
      :content="block.content"
      :streaming="streaming"
  />
  <!--
    預留 block type:citation / mermaid / file。
    啟用時加對應 component + v-else-if。
  -->
</template>
