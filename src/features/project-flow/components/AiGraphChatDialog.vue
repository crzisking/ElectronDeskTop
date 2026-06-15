<!--
  AI 改圖對話框 — 使用者用自然語言描述需求,送出後由父層(畫布)呼 LLM 取操作清單、
  直接套用到流程圖。本元件只負責「收集需求 + 顯示送出中」,不碰 API / 圖,保持薄。

  直接套用模式:沒有預覽步驟,套用後父層提供「回退」一鍵還原(快照對賬)。
-->
<template>
  <el-dialog
      :model-value="modelValue"
      :title="$t('projectFlow.aiGraph.title')"
      width="520"
      @update:model-value="(v) => $emit('update:modelValue', v)"
  >
    <p class="hint">{{ $t('projectFlow.aiGraph.hint') }}</p>

    <el-input
        v-model="text"
        :autosize="{minRows: 3, maxRows: 6}"
        :disabled="loading"
        :placeholder="$t('projectFlow.aiGraph.placeholder')"
        type="textarea"
        @keydown.enter.exact.prevent="submit"
    />

    <div class="examples">
      <span class="ex-label">{{ $t('projectFlow.aiGraph.examplesTitle') }}:</span>
      <el-tag
          v-for="(ex, i) in examples"
          :key="i"
          class="ex-tag"
          effect="plain"
          size="small"
          @click="!loading && (text = ex)"
      >{{ ex }}
      </el-tag>
    </div>

    <template #footer>
      <el-button :disabled="loading" @click="$emit('update:modelValue', false)">
        {{ $t('common.cancel') }}
      </el-button>
      <el-button :disabled="!text.trim()" :loading="loading" type="primary" @click="submit">
        {{ $t('projectFlow.aiGraph.submit') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import {useI18n} from 'vue-i18n'

defineProps<{
  modelValue: boolean
  /** 父層 LLM/套用進行中 → 鎖住輸入與按鈕 */
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  /** 送出需求,父層負責呼 AI + 套用 */
  submit: [instruction: string]
}>()

const {t} = useI18n()
const text = ref('')

const examples = [
  t('projectFlow.aiGraph.ex1'),
  t('projectFlow.aiGraph.ex2'),
  t('projectFlow.aiGraph.ex3'),
]

function submit() {
  const v = text.value.trim()
  if (!v) return
  emit('submit', v)
}

// 父層套用成功會關閉對話框;這裡清空輸入,下次開是乾淨的
defineExpose({reset: () => (text.value = '')})
</script>

<style scoped>
.hint {
  margin: 0 0 12px;
  color: #909399;
  font-size: 13px;
  line-height: 1.5;
}

.examples {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.ex-label {
  color: #909399;
  font-size: 12px;
}

.ex-tag {
  cursor: pointer;
}

.ex-tag:hover {
  color: var(--el-color-primary);
}
</style>
