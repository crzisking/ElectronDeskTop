<script setup lang="ts">
/**
 * 業務流水線編輯器
 *
 * ── 功能概述 ──────────────────────────────────────────────────────────
 * 使用 X6FlowChart 組件提供的可視化流程圖編輯能力，
 * 讓用戶創建、編輯、保存業務流水線。
 *
 * ── 頁面佈局 ──────────────────────────────────────────────────────────
 * ┌─────────────────────────────────────────┐
 * │ 工具欄：新增節點 | 保存 | 適配 | 重置  │
 * ├─────────────────────────────────────────┤
 * │                                         │
 * │            X6 流程圖畫布                 │
 * │                                         │
 * └─────────────────────────────────────────┘
 *
 * ── 操作說明 ──────────────────────────────────────────────────────────
 * - 點擊「新增節點」按鈕在畫布上添加節點
 * - 拖拽節點邊緣的連接樁（小圓點）來創建連線
 * - 選中節點/邊後按 Delete 鍵刪除
 * - Ctrl + 滾輪縮放畫布
 * - Shift + 拖拽平移畫布
 * - Ctrl+Z 撤銷，Ctrl+Y 重做
 *
 * ── API 接口預留 ─────────────────────────────────────────────────────
 * 保存功能調用 businessApi.savePipeline()，接口已預留但未連接後端。
 * 後端實現後，只需在 business.api.ts 中填入真實的 HTTP 請求即可。
 */

import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import X6FlowChart from '@/components/X6FlowChart/X6FlowChart.vue'
import type { FlowNode, FlowEdge } from '@/types/api.types'

// ── X6FlowChart 組件引用 ──────────────────────────────────────────
/** 通過 ref 獲取 X6FlowChart 實例，調用其公開方法（getGraphData、addNode 等） */
const flowChartRef = ref<InstanceType<typeof X6FlowChart>>()

// ── 狀態 ──────────────────────────────────────────────────────────
/** 當前編輯的流水線名稱 */
const pipelineName = ref('新建流水線')

/** 流程圖初始節點數據（空畫布，用戶從零開始創建） */
const initialNodes = ref<FlowNode[]>([])

/** 流程圖初始邊數據 */
const initialEdges = ref<FlowEdge[]>([])

/** 是否有未保存的變更 */
const hasUnsavedChanges = ref(false)

/** 保存中狀態 */
const isSaving = ref(false)

/** 新增節點的自增計數器（用於默認名稱） */
let nodeCounter = 0

// ── 方法 ──────────────────────────────────────────────────────────

/**
 * 新增節點
 * 在畫布上添加一個新的矩形節點，位置錯開避免重疊
 */
function handleAddNode() {
  if (!flowChartRef.value) return

  nodeCounter++
  const offsetX = 100 + (nodeCounter % 5) * 60     // 水平錯開
  const offsetY = 100 + Math.floor(nodeCounter / 5) * 80  // 垂直錯開

  flowChartRef.value.addNode(
    `流程節點 ${nodeCounter}`,
    offsetX,
    offsetY,
    'rect'
  )
}

/**
 * 保存流水線
 *
 * 從 X6FlowChart 導出當前圖數據，調用 API 保存。
 * TODO: 接入後端 API（business.api.ts 中已預留接口）
 */
async function handleSave() {
  if (!flowChartRef.value) return

  // 獲取當前畫布上的所有節點和邊
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
    // 調用示例：
    //   import { useBusinessApi } from '@/api/modules/business.api'
    //   const businessApi = useBusinessApi()
    //   await businessApi.savePipeline({
    //     name: pipelineName.value,
    //     description: '',
    //     nodes,
    //     edges
    //   })
    //
    // 目前使用 console.log 模擬保存，方便開發調試
    // ══════════════════════════════════════════════════════════════

    console.log('[PipelineEditor] 保存流水線數據:', {
      name: pipelineName.value,
      nodes,
      edges
    })

    // 模擬保存延遲
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

/** 適配畫布：縮放到顯示所有節點 */
function handleZoomToFit() {
  flowChartRef.value?.zoomToFit()
}

/** 重置縮放：恢復 100% 並居中 */
function handleZoomReset() {
  flowChartRef.value?.zoomReset()
}

/** 流程圖變更回調：標記有未保存的變更 */
function handleGraphChange() {
  hasUnsavedChanges.value = true
}

/** 節點雙擊：彈出編輯對話框修改節點名稱 */
async function handleNodeDblclick(node: FlowNode) {
  try {
    const { value } = await ElMessageBox.prompt(
      '請輸入節點名稱',
      '編輯節點',
      {
        inputValue: node.label,
        confirmButtonText: '確認',
        cancelButtonText: '取消'
      }
    )
    if (value && value !== node.label) {
      // TODO: 更新節點名稱（需要 X6FlowChart 提供 updateNode 方法）
      // 目前可以通過刪除舊節點+添加新節點實現
      console.log('[PipelineEditor] 更新節點名稱:', node.id, value)
    }
  } catch {
    // 用戶取消，忽略
  }
}
</script>

<template>
  <div class="pipeline-editor">
    <!-- ── 工具欄 ─────────────────────────────────────────────── -->
    <div class="toolbar">
      <!-- 左側：流水線名稱 + 操作按鈕 -->
      <div class="toolbar-left">
        <el-input
          v-model="pipelineName"
          class="pipeline-name-input"
          placeholder="流水線名稱"
          :maxlength="50"
        />

        <el-button type="primary" @click="handleAddNode">
          <el-icon><Plus /></el-icon>
          新增節點
        </el-button>

        <el-button
          type="success"
          :loading="isSaving"
          @click="handleSave"
        >
          保存
        </el-button>

        <!-- 未保存提示 -->
        <el-tag v-if="hasUnsavedChanges" type="warning" size="small">
          未保存
        </el-tag>
      </div>

      <!-- 右側：視圖控制按鈕 -->
      <div class="toolbar-right">
        <el-button-group>
          <el-button @click="handleZoomToFit">適配</el-button>
          <el-button @click="handleZoomReset">重置</el-button>
        </el-button-group>
      </div>
    </div>

    <!-- ── 操作提示 ───────────────────────────────────────────── -->
    <div class="tips">
      <el-text type="info" size="small">
        Ctrl+滾輪縮放 | Shift+拖拽平移 | 拖拽連接樁連線 | Backspace刪除選中
      </el-text>
    </div>

    <!-- ── X6 流程圖畫布 ─────────────────────────────────────── -->
    <div class="chart-wrapper">
      <X6FlowChart
        ref="flowChartRef"
        :nodes="initialNodes"
        :edges="initialEdges"
        :readonly="false"
        @graph-change="handleGraphChange"
        @node-dblclick="handleNodeDblclick"
      />
    </div>
  </div>
</template>

<style scoped>
/* ── 編輯器容器 ──────────────────────────────────────────── */
.pipeline-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 12px;
  min-height: 0; /* flex 子項需要此屬性來正確收縮 */
}

/* ── 工具欄 ──────────────────────────────────────────────── */
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

/* ── 操作提示 ──────────────────────────────────────────── */
.tips {
  flex-shrink: 0;
}

/* ── 畫布容器 ──────────────────────────────────────────── */
.chart-wrapper {
  flex: 1;
  min-height: 400px;
  border-radius: 8px;
  overflow: hidden;
}
</style>
