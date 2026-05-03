<script setup lang="ts">
/**
 * 業務流水線編輯器
 *
 * ── 功能概述 ──────────────────────────────────────────────────────────
 * 使用 VueFlowChart 組件提供的可視化流程圖編輯能力，
 * 讓用戶創建、編輯、保存業務流水線。
 *
 * ── 頁面佈局 ──────────────────────────────────────────────────────────
 * ┌──────────────────────────────────────────────────┐
 * │ 工具欄：流水線名稱 | 保存 | 適配 | 重置          │
 * │ 提示欄：操作提示文字                              │
 * ├──────────┬───────────────────────────────────────┤
 * │ 節點模板  │                                       │
 * │ 拖拽面板  │          Vue Flow 流程圖畫布           │
 * │          │                                       │
 * └──────────┴───────────────────────────────────────┘
 *
 * ── 操作說明 ──────────────────────────────────────────────────────────
 * - 從左側拖拽節點模板到畫布上新增節點
 * - 從節點的連接點拖線到另一個節點完成連線
 * - 點擊節點/邊選中，按 Backspace 刪除
 * - 滾輪縮放，拖拽空白區域平移畫布
 *
 * ── API 接口預留 ─────────────────────────────────────────────────────
 * 保存功能調用 businessApi.savePipeline()，接口已預留但未連接後端。
 * 後端實現後，只需在 business.api.ts 中填入真實的 HTTP 請求即可。
 */

import {onBeforeUnmount, ref} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {onBeforeRouteLeave} from 'vue-router'
import VueFlowChart from '@/components/VueFlowChart/VueFlowChart.vue'

// ── 組件引用 ──────────────────────────────────────────────────────
/** 通過 ref 獲取 VueFlowChart 實例，調用其公開方法 */
const flowChartRef = ref<InstanceType<typeof VueFlowChart>>()

// ── 狀態 ──────────────────────────────────────────────────────────
/** 當前編輯的流水線名稱 */
const pipelineName = ref('新建流水線')

/** 是否有未保存的變更 */
const hasUnsavedChanges = ref(false)

/** 保存中狀態 */
const isSaving = ref(false)

// ── 方法 ──────────────────────────────────────────────────────────

/**
 * 保存流水線
 *
 * 從 VueFlowChart 導出當前圖數據，調用 API 保存。
 * TODO: 接入後端 API（business.api.ts 中已預留接口）
 */
async function handleSave() {
  if (!flowChartRef.value) return

  const { nodes, edges } = flowChartRef.value.getGraphData()

  if (nodes.length === 0) {
    ElMessage.warning('流程圖為空，請至少添加一個節點')
    return
  }

  isSaving.value = true
  try {
    // ══════════════════════════════════════════════════════════════
    // TODO: 接入後端 API
    //
    //   import { useBusinessApi } from '@/api/modules/business.api'
    //   const businessApi = useBusinessApi()
    //   await businessApi.savePipeline({
    //     name: pipelineName.value,
    //     description: '',
    //     nodes,
    //     edges
    //   })
    // ══════════════════════════════════════════════════════════════

    await new Promise((resolve) => setTimeout(resolve, 500))

    hasUnsavedChanges.value = false
    ElMessage.success('流水線保存成功')
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? '保存失敗'
    ElMessage.error(`保存失敗：${msg}`)
  } finally {
    isSaving.value = false
  }
}

/** 適配畫布 */
function handleZoomToFit() {
  flowChartRef.value?.zoomToFit()
}

/** 圖變更回調 */
function handleChange() {
  hasUnsavedChanges.value = true
}

/**
 * 離開頁面保護：有未保存變更時彈出確認提示
 * 覆蓋 Vue Router 導航和瀏覽器關閉/刷新兩種場景
 */
onBeforeRouteLeave(async () => {
  if (!hasUnsavedChanges.value) return true
  try {
    await ElMessageBox.confirm(
        '當前流水線有未保存的變更，離開後將丟失。是否繼續？',
        '未保存的變更',
        {confirmButtonText: '離開', cancelButtonText: '留下', type: 'warning'}
    )
    return true
  } catch {
    return false
  }
})

/** 瀏覽器關閉/刷新時的 beforeunload 保護 */
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
}

window.addEventListener('beforeunload', onBeforeUnload)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div class="pipeline-editor">
    <!-- ── 工具欄 ─────────────────────────────────────────── -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-input
          v-model="pipelineName"
          class="pipeline-name-input"
          placeholder="流水線名稱"
          :maxlength="50"
        />

<!--        <el-button-->
<!--          type="success"-->
<!--          :loading="isSaving"-->
<!--          @click="handleSave"-->
<!--        >-->
<!--          保存-->
<!--        </el-button>-->

        <el-tag v-if="hasUnsavedChanges" type="warning" size="small">
          未保存
        </el-tag>
      </div>

      <div class="toolbar-right">
        <el-button @click="handleZoomToFit">適配</el-button>
      </div>
    </div>

    <!-- ── 操作提示 ───────────────────────────────────────── -->
    <div class="tips">
      <el-text type="info" size="small">
        從左側拖拽節點到畫布 | 雙擊節點編輯資訊 | 拖拽連接點連線 | Backspace 刪除 | 滾輪縮放
      </el-text>
    </div>

    <!-- ── 流程圖畫布 ─────────────────────────────────────── -->
    <div class="chart-wrapper">
      <VueFlowChart
        ref="flowChartRef"
        @change="handleChange"
      />
    </div>
  </div>
</template>

<style scoped>
.pipeline-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 12px;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pipeline-name-input {
  width: 200px;
}

.tips {
  flex-shrink: 0;
}

.chart-wrapper {
  flex: 1;
  min-height: 400px;
}
</style>
