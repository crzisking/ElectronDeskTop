<script setup lang="ts">
/**
 * VueFlowChart — 基於 @vue-flow/core 的通用流程圖組件
 *
 * ── 組件職責 ──────────────────────────────────────────────────────────
 * 封裝 Vue Flow 畫布，提供：
 *  1. 左側拖拽面板：5 種節點模板，拖動到畫布上即可新增
 *  2. 流程圖畫布：支持拖拽、連線、縮放、平移
 *  3. Backspace 刪除選中的節點和邊
 *  4. 雙擊節點開啟編輯對話框，維護節點資訊（工號、姓名、部門代碼）
 *  5. 數據導出：getGraphData() 導出 nodes/edges JSON
 *
 * ── 5 種節點類型 ─────────────────────────────────────────────────────
 * | 類型       | 顏色  | 用途                     |
 * |-----------|-------|--------------------------|
 * | start     | 綠色  | 流程起點                  |
 * | end       | 紅色  | 流程終點                  |
 * | task      | 藍色  | 具體任務/工作項            |
 * | approval  | 橙色  | 審批環節                  |
 * | condition | 紫色  | 條件分支判斷              |
 *
 * ── 設計說明 ──────────────────────────────────────────────────────────
 * 此流程圖用於靜態業務流程留存，存入資料庫供日後查詢負責人。
 * 每個節點記錄：工號（employeeId）、姓名（employeeName）、部門代碼（departmentCode）。
 * 不含動態狀態追蹤欄位（如 status、estimatedDays）。
 */

import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import type { Node, Edge, Connection } from '@vue-flow/core'

// 匯入 Vue Flow 基礎樣式（必須）
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// 匯入自定義節點組件
import StartNode from './nodes/StartNode.vue'
import EndNode from './nodes/EndNode.vue'
import TaskNode from './nodes/TaskNode.vue'
import ApprovalNode from './nodes/ApprovalNode.vue'
import ConditionNode from './nodes/ConditionNode.vue'

import type { FlowNodeData, FlowNodeType } from '@/types/api.types'

// ── Props ──────────────────────────────────────────────────────────
interface Props {
  /** 初始節點數據（從後端加載或空數組） */
  initialNodes?: Node[]
  /** 初始邊數據（從後端加載或空數組） */
  initialEdges?: Edge[]
}

const props = withDefaults(defineProps<Props>(), {
  initialNodes: () => [],
  initialEdges: () => []
})

// ── Events ─────────────────────────────────────────────────────────
const emit = defineEmits<{
  /** 圖發生任何變更時觸發（可用於標記「未保存」） */
  (e: 'change'): void
}>()

// ── Vue Flow 實例 ──────────────────────────────────────────────────
const {
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  getSelectedNodes,
  getSelectedEdges,
  getNodes,
  onConnect,
  fitView,
  toObject,
  project
} = useVueFlow()

// ── 響應式數據 ─────────────────────────────────────────────────────
/** 畫布上的節點（響應式，Vue Flow 雙向綁定） */
const nodes = ref<Node[]>([...props.initialNodes])

/** 畫布上的邊（響應式，Vue Flow 雙向綁定） */
const edges = ref<Edge[]>([...props.initialEdges])

/** 節點自增 ID 計數器 */
let nodeIdCounter = 0

// ── 節點編輯對話框 ─────────────────────────────────────────────────
/** 編輯對話框是否可見 */
const editDialogVisible = ref(false)

/** 正在編輯的節點 ID */
const editingNodeId = ref<string | null>(null)

/** 編輯表單數據 */
const editForm = reactive<{
  label: string
  employeeId: string
  employeeName: string
  departmentCode: string
  description: string
}>({
  label: '',
  employeeId: '',
  employeeName: '',
  departmentCode: '',
  description: ''
})

/**
 * 雙擊節點時打開編輯對話框
 *
 * 從節點的 data 中讀取當前值填入表單，
 * 用戶修改後點「確認」保存回節點。
 */
function openEditDialog(nodeId: string) {
  const node = getNodes.value.find(n => n.id === nodeId)
  if (!node) return

  const data = node.data as FlowNodeData
  editingNodeId.value = nodeId
  editForm.label = data.label || ''
  editForm.employeeId = data.employeeId || ''
  editForm.employeeName = data.employeeName || ''
  editForm.departmentCode = data.departmentCode || ''
  editForm.description = data.description || ''
  editDialogVisible.value = true
}

/**
 * 確認編輯：將表單數據寫回節點
 *
 * 直接修改 nodes 數組中對應節點的 data，
 * Vue Flow 會自動響應式更新畫布。
 */
function confirmEdit() {
  if (!editingNodeId.value) return

  const list = nodes.value as unknown as Array<{ id: string; data: FlowNodeData }>
  const found = list.find((n) => n.id === editingNodeId.value)
  const node = found as unknown as Node | undefined
  if (node) {
    node.data = {
      ...node.data,
      label: editForm.label,
      employeeId: editForm.employeeId || undefined,
      employeeName: editForm.employeeName || undefined,
      departmentCode: editForm.departmentCode || undefined,
      description: editForm.description || undefined
    } as FlowNodeData
    emit('change')
  }

  editDialogVisible.value = false
  editingNodeId.value = null
}

/** 取消編輯 */
function cancelEdit() {
  editDialogVisible.value = false
  editingNodeId.value = null
}

// ── 左側拖拽面板的節點模板定義 ──────────────────────────────────────
const nodeTemplates: {
  type: FlowNodeType
  label: string
  description: string
  color: string
}[] = [
  {
    type: 'start',
    label: '開始節點',
    description: '流程起點',
    color: '#67c23a'
  },
  {
    type: 'task',
    label: '任務節點',
    description: '具體工作項',
    color: '#409eff'
  },
  {
    type: 'approval',
    label: '審批節點',
    description: '需要審批的環節',
    color: '#e6a23c'
  },
  {
    type: 'condition',
    label: '條件節點',
    description: '分支判斷',
    color: '#a855f7'
  },
  {
    type: 'end',
    label: '結束節點',
    description: '流程終點',
    color: '#f56c6c'
  }
]

// ── 拖拽新增節點邏輯 ───────────────────────────────────────────────
let draggedType: FlowNodeType | null = null

function onDragStart(event: DragEvent, type: FlowNodeType) {
  if (!event.dataTransfer) return
  draggedType = type
  event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent) {
  if (!draggedType) return

  const flowContainer = (event.target as HTMLElement).closest('.vue-flow')
  if (!flowContainer) return
  const rect = flowContainer.getBoundingClientRect()

  const position = project({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  })

  const newNode = createNode(draggedType, position)
  addNodes([newNode])

  emit('change')
  draggedType = null
}

/**
 * 根據類型和位置創建一個新節點對象
 *
 * 新節點的 data 只包含 label 和 nodeType，
 * 其餘欄位（工號、姓名、部門代碼）留空，
 * 用戶拖入後可雙擊節點開啟編輯對話框填寫。
 */
function createNode(
  type: FlowNodeType,
  position: { x: number; y: number }
): Node {
  nodeIdCounter++
  const id = `node-${Date.now()}-${nodeIdCounter}`

  const defaultLabels: Record<FlowNodeType, string> = {
    start: '流程開始',
    end: '流程結束',
    task: `任務 ${nodeIdCounter}`,
    approval: `審批 ${nodeIdCounter}`,
    condition: `條件判斷 ${nodeIdCounter}`
  }

  const data: FlowNodeData = {
    label: defaultLabels[type],
    nodeType: type
  }

  return {
    id,
    type,
    position,
    data
  }
}

// ── 連線完成回調 ───────────────────────────────────────────────────
onConnect((connection: Connection) => {
  const edgeId = `edge-${connection.source}-${connection.target}`
  addEdges([
    {
      id: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      animated: false,
      style: { stroke: '#5F95FF', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as any, color: '#5F95FF' }
    }
  ])
  emit('change')
})

// ── Backspace 刪除選中元素 ─────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  if (e.key === 'Backspace') {
    const selectedNodes = getSelectedNodes.value
    const selectedEdges = getSelectedEdges.value

    if (selectedNodes.length > 0) {
      removeNodes(selectedNodes.map(n => n.id))
      emit('change')
    }
    if (selectedEdges.length > 0) {
      removeEdges(selectedEdges.map(e => e.id))
      emit('change')
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})

// ── 監聽 props 變化重新載入數據 ────────────────────────────────────
watch(
  () => [props.initialNodes, props.initialEdges],
  () => {
    nodes.value = [...props.initialNodes]
    edges.value = [...props.initialEdges]
  },
  { deep: true }
)

// ── 公開方法 ───────────────────────────────────────────────────────
function getGraphData(): { nodes: Node[]; edges: Edge[] } {
  const obj = toObject()
  return {
    nodes: obj.nodes,
    edges: obj.edges
  }
}

function zoomToFit() {
  fitView({ padding: 0.2 })
}

defineExpose({
  getGraphData,
  zoomToFit
})
</script>

<template>
  <div class="vue-flowchart-container">
    <!--
      ═══ 左側拖拽面板 ═══
      展示 5 種節點模板，用戶拖動到右側畫布上即可新增節點。
    -->
    <aside class="node-palette">
      <div class="palette-title">節點模板</div>
      <div class="palette-hint">拖動到畫布新增</div>

      <div
        v-for="tpl in nodeTemplates"
        :key="tpl.type"
        class="palette-item"
        :style="{ borderLeftColor: tpl.color }"
        draggable="true"
        @dragstart="(e) => onDragStart(e, tpl.type)"
      >
        <div class="palette-item-dot" :style="{ background: tpl.color }" />
        <div class="palette-item-info">
          <div class="palette-item-label">{{ tpl.label }}</div>
          <div class="palette-item-desc">{{ tpl.description }}</div>
        </div>
      </div>

      <!-- 操作提示 -->
      <div class="palette-tips">
        <div class="tip-item">雙擊節點 → 編輯資訊</div>
        <div class="tip-item">Backspace → 刪除選中</div>
        <div class="tip-item">滾輪 → 縮放畫布</div>
      </div>
    </aside>

    <!--
      ═══ 右側 Vue Flow 畫布 ═══
      - v-model：雙向綁定 nodes 和 edges
      - @dragover / @drop：接收從拖拽面板拖入的節點
      - @node-double-click：雙擊節點開啟編輯對話框
      - fit-view-on-init：初始自動縮放適配
    -->
    <div
      class="flow-canvas"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :fit-view-on-init="true"
        :snap-to-grid="true"
        :snap-grid="[15, 15]"
        :default-edge-options="{
          style: { stroke: '#5F95FF', strokeWidth: 2 },
          markerEnd: { type: 'arrowclosed' as any, color: '#5F95FF' }
        }"
        @nodes-change="() => emit('change')"
        @edges-change="() => emit('change')"
        @node-double-click="({ node }) => openEditDialog(node.id)"
      >
        <!-- 自定義節點插槽 -->
        <template #node-start="nodeProps">
          <StartNode v-bind="nodeProps" />
        </template>

        <template #node-end="nodeProps">
          <EndNode v-bind="nodeProps" />
        </template>

        <template #node-task="nodeProps">
          <TaskNode v-bind="nodeProps" />
        </template>

        <template #node-approval="nodeProps">
          <ApprovalNode v-bind="nodeProps" />
        </template>

        <template #node-condition="nodeProps">
          <ConditionNode v-bind="nodeProps" />
        </template>
      </VueFlow>
    </div>

    <!--
      ═══ 節點編輯對話框 ═══
      雙擊節點後打開，可維護：
      - 節點標題（label）
      - 工號（employeeId）
      - 姓名（employeeName）
      - 部門代碼（departmentCode）
      - 描述（description）
    -->
    <el-dialog
      v-model="editDialogVisible"
      title="編輯節點資訊"
      width="460px"
      :close-on-click-modal="false"
      @close="cancelEdit"
    >
      <el-form label-width="90px" label-position="left">
        <el-form-item label="節點標題">
          <el-input
            v-model="editForm.label"
            placeholder="請輸入節點標題"
            :maxlength="50"
          />
        </el-form-item>

        <el-form-item label="工號">
          <el-input
            v-model="editForm.employeeId"
            placeholder="例如：A12345"
            :maxlength="20"
          />
        </el-form-item>

        <el-form-item label="姓名">
          <el-input
            v-model="editForm.employeeName"
            placeholder="負責人姓名"
            :maxlength="30"
          />
        </el-form-item>

        <el-form-item label="部門代碼">
          <el-input
            v-model="editForm.departmentCode"
            placeholder="例如：IT-001"
            :maxlength="20"
          />
        </el-form-item>

        <el-form-item label="描述">
          <el-input
            v-model="editForm.description"
            type="textarea"
            placeholder="此步驟的具體說明（選填）"
            :rows="3"
            :maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" @click="confirmEdit">確認</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* ── 整體佈局：左右分欄 ───────────────────────────────── */
.vue-flowchart-container {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 400px;
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

/* ── 左側拖拽面板 ─────────────────────────────────────── */
.node-palette {
  width: 180px;
  flex-shrink: 0;
  padding: 16px 12px;
  background: #fafafa;
  border-right: 1px solid var(--el-border-color-lighter, #e4e7ed);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.palette-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.palette-hint {
  font-size: 11px;
  color: #909399;
  margin-bottom: 8px;
}

/* 拖拽面板中的節點模板卡片 */
.palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-left: 3px solid;
  border-radius: 6px;
  cursor: grab;
  transition: box-shadow 0.15s, transform 0.15s;
  user-select: none;
}

.palette-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.palette-item-info {
  min-width: 0;
}

.palette-item-label {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
}

.palette-item-desc {
  font-size: 10px;
  color: #909399;
}

/* ── 操作提示 ─────────────────────────────────────────── */
.palette-tips {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tip-item {
  font-size: 10px;
  color: #909399;
  line-height: 1.5;
}

/* ── 右側畫布 ─────────────────────────────────────────── */
.flow-canvas {
  flex: 1;
  min-width: 0;
  height: 100%;
}
</style>
