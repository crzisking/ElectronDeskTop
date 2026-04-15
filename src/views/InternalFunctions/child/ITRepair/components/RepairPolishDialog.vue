<script setup lang="ts">
/**
 * RepairPolishDialog — AI 整理彈窗組件
 *
 * 純 UI 展示組件，不包含任何業務邏輯，所有狀態由父層（ITRepairView）管理。
 *
 * 佈局：
 *  ┌─────────────────────────────┐
 *  │ 原始描述（只讀 textarea）    │
 *  │ ↓ AI 整理結果               │
 *  │ 整理後的版本（可編輯 textarea）│
 *  ├────────────────┬────────────┤
 *  │    取消        │ 使用此版本  │
 *  └────────────────┴────────────┘
 *
 * Props:
 *  @prop modelValue   {boolean} 彈窗顯示狀態，支持 v-model
 *  @prop loading      {boolean} 是否正在串流生成，true 時顯示「生成中...」標籤
 *  @prop originalText {string}  原始描述純文字（由父層調用 getPlainText 轉換後傳入）
 *  @prop result       {string}  AI 整理結果，支持 v-model 允許用戶手動微調
 *
 * Emits:
 *  @emit update:modelValue  彈窗關閉時通知父層更新 visible 狀態
 *  @emit update:result      用戶手動編輯結果文字時同步到父層
 *  @emit apply              點擊「使用此版本」按鈕，父層執行 applyPolish
 *  @emit close              點擊取消或右上角關閉，父層執行 closePolish（含中止串流）
 */

defineProps<{
  modelValue: boolean
  loading: boolean
  originalText: string
  result: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:result': [value: string]
  apply: []
  close: []
}>()
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="✨ 使用AI整理"
    width="680px"
    :close-on-click-modal="false"
    :before-close="() => emit('close')"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="polish-content">
      <!-- 原始描述（只讀） -->
      <div class="polish-section-label">原始描述</div>
      <el-input
        :value="originalText"
        type="textarea"
        :rows="4"
        readonly
        resize="none"
        class="polish-original"
      />

      <!-- 方向指示 -->
      <div class="polish-arrow">↓ AI 整理結果</div>

      <!-- 整理結果（可手動微調後再採用） -->
      <div class="polish-section-label">
        整理後的版本
        <!-- loading 期間顯示「生成中...」標籤，告知用戶正在串流接收 -->
        <el-tag v-if="loading" size="small" type="primary" effect="plain">生成中...</el-tag>
      </div>
      <el-input
        :model-value="result"
        type="textarea"
        :rows="6"
        resize="none"
        placeholder="AI 正在生成中..."
        class="polish-result"
        @update:model-value="emit('update:result', $event)"
      />
    </div>

    <template #footer>
      <!-- 取消：關閉彈窗並中止未完成的串流請求 -->
      <el-button @click="emit('close')">取消</el-button>
      <!-- 使用此版本：result 為空時禁用，防止回填空內容 -->
      <el-button
        type="primary"
        :disabled="!result.trim()"
        @click="emit('apply')"
      >
        使用此版本
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 彈窗內容區縱向排列，各元素間距均勻 */
.polish-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 區塊標題（「原始描述」/「整理後的版本」），行內排列支持右側附加 Tag */
.polish-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 方向箭頭文字，居中顯示 */
.polish-arrow {
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 0;
}

/* 原始描述使用淺灰背景區分只讀狀態 */
.polish-original :deep(textarea) {
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
}

/* 整理結果保持正常閱讀字號和行高，便於用戶微調 */
.polish-result :deep(textarea) {
  font-size: 14px;
  line-height: 1.7;
}
</style>
