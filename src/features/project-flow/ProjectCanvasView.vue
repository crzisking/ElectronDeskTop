<!--
  項目流程畫布(docs/20 §5.2)— @antv/x6 v3 + Element Plus,不再用 prompt。

  三欄佈局:
   - 左 Stencil(220px):任務 / 里程碑 / 決策 三個拖拉模板
   - 中 Graph:節點 + 連線,Ctrl+滾輪縮放,空白拖移
   - 右 NodeInspector(320px):選中節點時展開,顯示詳情 + 操作 + 關聯匯報

  互動規則:
   - 拖入 stencil → 自動建節點(後端 createNode + 寫回 nodeId)
   - 點節點 → 右側 Inspector 展開
   - 拖節點位置 → 即時同步後端 (node:moved)
   - hover 節點顯示 4 個 port → 拖 port-to-port 建連線
   - 改 title/status/description/assignee 都在 Inspector 內
   - 刪節點按鈕在 Inspector 底部(危險動作集中)
   - 不再有右鍵 prompt(原本 rename/delete/status 都收進 Inspector)
-->
<template>
  <div class="canvas-view">
    <header class="header">
      <!-- 返回 = 回項目列表(上一級),不走瀏覽歷史 -->
      <el-button size="small" @click="$router.push({name: 'project-flow'})">← {{ $t('common.back') }}</el-button>
      <h3 class="title">{{ detail?.project?.name ?? '-' }}</h3>

      <!-- 唯讀成員看得到但不能動;tag 讓使用者知道為什麼不能編輯 -->
      <el-tag v-if="detail && !canEdit" size="small" type="info">{{ $t('projectFlow.members.readonlyTag') }}</el-tag>

      <!-- 畫布(編排依賴關係)/ 時間線(看排期與人員)雙視圖,同一份數據 -->
      <el-radio-group v-model="viewMode" size="small">
        <el-radio-button value="canvas">{{ $t('projectFlow.canvas.viewCanvas') }}</el-radio-button>
        <el-radio-button value="timeline">{{ $t('projectFlow.canvas.viewTimeline') }}</el-radio-button>
      </el-radio-group>

      <el-button-group v-if="viewMode === 'canvas'" size="small">
        <el-tooltip :content="$t('projectFlow.canvas.zoomOut')">
          <el-button :icon="ZoomOut" @click="zoomBy(-0.1)"/>
        </el-tooltip>
        <el-button style="min-width: 72px" @click="zoomReset">{{ Math.round(currentZoom * 100) }}%</el-button>
        <el-tooltip :content="$t('projectFlow.canvas.zoomIn')">
          <el-button :icon="ZoomIn" @click="zoomBy(0.1)"/>
        </el-tooltip>
        <el-tooltip :content="$t('projectFlow.canvas.fit')">
          <el-button :icon="FullScreen" @click="fitContent"/>
        </el-tooltip>
      </el-button-group>
      <el-button size="small" @click="membersDialogVisible = true">
        👥 {{ $t('projectFlow.members.title') }}
      </el-button>
      <span class="hint">{{ $t('projectFlow.canvas.hint') }}</span>
    </header>

    <ProjectMembersDialog
        v-model="membersDialogVisible"
        :can-manage="canManageMembers"
        :project-id="currentProjectId()"
    />

    <div class="body">
      <aside v-show="viewMode === 'canvas'" class="stencil">
        <div class="stencil-title">{{ $t('projectFlow.canvas.stencilTitle') }}</div>
        <div class="stencil-hint">{{ $t('projectFlow.canvas.dragHint') }}</div>
        <div
            v-for="tpl in TEMPLATES"
            :key="tpl.type"
            :style="{borderColor: NODE_TYPE_COLOR[tpl.type].stroke, background: NODE_TYPE_COLOR[tpl.type].fill}"
            class="stencil-item"
            draggable="true"
            @dragstart="onDragStart($event, tpl.type)"
        >
          {{ $t(tpl.labelKey) }}
        </div>
      </aside>

      <!-- v-show 不是 v-if:graph 實例要保活,切回畫布不用重建 -->
      <div
          v-show="viewMode === 'canvas'"
          ref="graphContainerRef"
          class="graph"
          @drop="onCanvasDrop"
          @dragover.prevent
      ></div>

      <ProjectTimeline
          v-if="viewMode === 'timeline'"
          :nodes="detail?.nodes ?? []"
          class="graph"
          @select="(n) => (selectedNode = {...n})"
      />

      <NodeInspector
          v-if="selectedNode"
          :node="selectedNode"
          :readonly="!canEdit"
          @close="closeInspector"
          @delete="onDeleteSelected"
          @update="onNodeUpdated"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'
import {useRoute} from 'vue-router'
import {Graph, Shape} from '@antv/x6'
import {ElMessage} from 'element-plus'
import {FullScreen, ZoomIn, ZoomOut} from '@element-plus/icons-vue'
import {useI18n} from 'vue-i18n'
import {logger} from '@/shared/utils/logger'
import {projectFlowApi} from './api'
import type {EdgeResponse, NodeResponse, ProjectDetailResponse} from './types'
import NodeInspector from './components/NodeInspector.vue'
import ProjectTimeline from './components/ProjectTimeline.vue'
import ProjectMembersDialog from './components/ProjectMembersDialog.vue'

const TAG = 'ProjectCanvasView'
const route = useRoute()
const {t} = useI18n()

const graphContainerRef = ref<HTMLDivElement | null>(null)
const detail = ref<ProjectDetailResponse | null>(null)
const currentZoom = ref(1)
const selectedNode = ref<NodeResponse | null>(null)
const viewMode = ref<'canvas' | 'timeline'>('canvas')

let graph: Graph | null = null

/** 後端 detail.myRole 決定:owner / editor 可編;viewer 全唯讀(畫布互動 + 檢視器都關) */
const canEdit = computed(() => detail.value?.myRole === 'owner' || detail.value?.myRole === 'editor')
/** 成員管理:owner 才開放(管理員後端會放行,但桌面入口只給 owner 保持簡單) */
const canManageMembers = computed(() => detail.value?.myRole === 'owner')
const membersDialogVisible = ref(false)

// ── 節點 shape 註冊 ────────────────────────────────────────

const NODE_SHAPE = 'pf-flow-node'

const NODE_TYPE_COLOR: Record<string, { fill: string; stroke: string }> = {
  task: {fill: '#ffffff', stroke: '#5F95FF'},
  milestone: {fill: '#FFF7E6', stroke: '#FA8C16'},
  decision: {fill: '#FFF1F0', stroke: '#F5222D'},
}

const TEMPLATES: { type: string; labelKey: string }[] = [
  {type: 'task', labelKey: 'projectFlow.canvas.shapeTask'},
  {type: 'milestone', labelKey: 'projectFlow.canvas.shapeMilestone'},
  {type: 'decision', labelKey: 'projectFlow.canvas.shapeDecision'},
]

function ensureShapeRegistered(): void {
  try {
    Graph.registerNode(NODE_SHAPE, {
      inherit: 'rect',
      width: 140,
      height: 48,
      attrs: {
        body: {strokeWidth: 1, stroke: '#5F95FF', fill: '#ffffff', rx: 6, ry: 6},
        label: {fontSize: 13, fill: '#262626', textAnchor: 'middle', textVerticalAnchor: 'middle'},
      },
      ports: {
        groups: {
          top: {position: 'top', attrs: {circle: portAttrs()}},
          right: {position: 'right', attrs: {circle: portAttrs()}},
          bottom: {position: 'bottom', attrs: {circle: portAttrs()}},
          left: {position: 'left', attrs: {circle: portAttrs()}},
        },
        items: [
          {id: 'top', group: 'top'},
          {id: 'right', group: 'right'},
          {id: 'bottom', group: 'bottom'},
          {id: 'left', group: 'left'},
        ],
      },
    }, true)
  } catch (err) {
    logger.debug(`registerNode 已存在: ${(err as Error).message}`, TAG)
  }
}

function portAttrs() {
  return {
    r: 4,
    magnet: true,
    stroke: '#5F95FF',
    strokeWidth: 1,
    fill: '#ffffff',
    style: {visibility: 'hidden'},
  }
}

onMounted(async () => {
  ensureShapeRegistered()
  await loadProject()
  initGraph()
  renderProject()
})

onBeforeUnmount(() => {
  graph?.dispose()
  graph = null
})

async function loadProject() {
  const projectId = Number(route.params.projectId)
  try {
    detail.value = (await projectFlowApi.getProject(projectId)) as ProjectDetailResponse
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function currentProjectId(): number {
  return detail.value?.project?.projectId ?? Number(route.params.projectId)
}

// ─── Graph ─────────────────────────────────────────────────

function initGraph() {
  if (!graphContainerRef.value) return
  graph = new Graph({
    container: graphContainerRef.value,
    autoResize: true,
    grid: {visible: true, type: 'dot', args: {color: '#e0e0e0', thickness: 1}},
    background: {color: '#fafafa'},
    panning: {enabled: true, modifiers: []},
    mousewheel: {enabled: true, modifiers: ['ctrl'], factor: 1.1, maxScale: 3, minScale: 0.3},
    interacting: () => canEdit.value,
    connecting: {
      allowBlank: false,
      allowLoop: false,
      allowNode: false,
      allowEdge: false,
      allowMulti: false,
      highlight: true,
      snap: {radius: 20},
      router: {name: 'manhattan'},
      connector: {name: 'rounded', args: {radius: 6}},
      validateConnection({sourceMagnet, targetMagnet}) {
        return !!sourceMagnet && !!targetMagnet
      },
      createEdge() {
        return new Shape.Edge({
          attrs: {
            line: {
              stroke: '#A2B1C3',
              strokeWidth: 1.5,
              targetMarker: {name: 'block', width: 8, height: 6},
            },
          },
          zIndex: 0,
        })
      },
    },
    highlighting: {
      magnetAvailable: {name: 'stroke', args: {padding: 3, attrs: {strokeWidth: 2, stroke: '#5F95FF'}}},
      magnetAdsorbed: {name: 'stroke', args: {padding: 3, attrs: {strokeWidth: 3, stroke: '#67C23A'}}},
    },
  })

  graph.on('node:mouseenter', ({node}) => {
    node.getPorts().forEach((p) => node.setPortProp(p.id!, 'attrs/circle/style/visibility', 'visible'))
  })
  graph.on('node:mouseleave', ({node}) => {
    node.getPorts().forEach((p) => node.setPortProp(p.id!, 'attrs/circle/style/visibility', 'hidden'))
  })

  graph.on('scale', ({sx}) => {
    currentZoom.value = sx
  })

  // 點節點 → 顯示 inspector;點空白 → 收起
  graph.on('node:click', ({node}) => {
    const nodeId = Number(node.id)
    if (!Number.isFinite(nodeId)) return // temp 節點(x6 UUID)還沒 sync 完,先不開 inspector
    const original = detail.value?.nodes.find((n) => n.nodeId === nodeId)
    if (original) {
      selectedNode.value = {...original}
    }
  })
  graph.on('blank:click', () => {
    selectedNode.value = null
  })

  // 拖完節點 → 同步位置
  graph.on('node:moved', async ({node}) => {
    if (!canEdit.value) return
    const data = node.getData() as { synced?: boolean } | undefined
    if (!data?.synced) return
    const nodeIdNum = Number(node.id)
    if (!Number.isFinite(nodeIdNum)) return // 防 NaN:id 不是數字代表還沒跟後端 sync
    const pos = node.getPosition()
    try {
      await projectFlowApi.updateNode(nodeIdNum, {positionX: pos.x, positionY: pos.y})
      // 同步 detail.value.nodes 對應節點的 positionX/Y,inspector 不會看到舊值
      const orig = detail.value?.nodes.find((n) => n.nodeId === Number(node.id))
      if (orig) {
        orig.positionX = pos.x
        orig.positionY = pos.y
      }
    } catch (err) {
      logger.warn(`updateNode 失敗: ${(err as Error).message}`, TAG)
    }
  })

  // 新連線 → 後端建立
  graph.on('edge:connected', async ({edge, isNew}) => {
    if (!isNew || !canEdit.value) return
    const src = Number(edge.getSourceCellId())
    const tgt = Number(edge.getTargetCellId())
    // 兩端必須是已 sync 的數字 id;連到 temp 節點(x6 UUID)直接取消
    if (!Number.isFinite(src) || !Number.isFinite(tgt)) {
      edge.remove()
      return
    }
    try {
      const r = await projectFlowApi.createEdge(currentProjectId(), {
        sourceNodeId: src,
        targetNodeId: tgt,
      })
      edge.setProp('id', String((r as { edgeId: number }).edgeId))
    } catch (err) {
      edge.remove()
      ElMessage.error((err as Error).message)
    }
  })

  currentZoom.value = graph.zoom()
}

// ─── Stencil drag-drop ────────────────────────────────────

function onDragStart(e: DragEvent, nodeType: string) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('application/x-pf-node-type', nodeType)
  e.dataTransfer.effectAllowed = 'copy'
}

/**
 * stencil drop → 建節點。
 *
 * ⚠️ x6 的 cell id 不可變 — `node.setProp('id', ...)` 無效。
 * 因此流程是:先放一個 temp 節點給使用者即時回饋 → 後端 createNode 拿 nodeId →
 * 移除 temp → 用後端 id 重建正式節點(data.synced=true)。
 * 失敗則移除 temp + toast。
 */
async function onCanvasDrop(e: DragEvent) {
  e.preventDefault()
  if (!graph || !canEdit.value) return
  const nodeType = e.dataTransfer?.getData('application/x-pf-node-type') ?? ''
  if (!nodeType) return
  const local = graph.clientToLocal({x: e.clientX, y: e.clientY})
  const x = local.x - 70
  const y = local.y - 24
  const color = NODE_TYPE_COLOR[nodeType] ?? NODE_TYPE_COLOR.task
  const labelText = t(`projectFlow.canvas.shape${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}`)

  const nodeAttrs = {
    body: {fill: color.fill, stroke: color.stroke, strokeWidth: 1, rx: 6, ry: 6},
    label: {text: labelText, fontSize: 13, fill: '#262626'},
  }

  // temp 節點:synced=false → node:moved 不上報;id 是 x6 UUID,不會被誤用
  const tempNode = graph.addNode({
    shape: NODE_SHAPE, x, y, attrs: nodeAttrs,
    data: {synced: false, nodeType},
  })

  try {
    const r = await projectFlowApi.createNode(currentProjectId(), {
      title: labelText, positionX: x, positionY: y, nodeType,
    })
    const nodeId = (r as { nodeId: number }).nodeId

    // x6 id 不可變,移除 temp 再用後端 id 重建
    tempNode.remove()
    graph.addNode({
      id: String(nodeId),
      shape: NODE_SHAPE, x, y, attrs: nodeAttrs,
      data: {synced: true, nodeType},
    })

    // detail.nodes 同步,讓點擊節點時 inspector 查得到資料
    detail.value?.nodes.push({
      nodeId, projectId: currentProjectId(),
      title: labelText, status: 'not_started', priority: 0,
      positionX: x, positionY: y, width: 140, height: 48,
      nodeType: nodeType as NodeResponse['nodeType'],
      sortOrder: 0,
      updatedAt: Date.now(),
    } as NodeResponse)
  } catch (err) {
    tempNode.remove()
    ElMessage.error((err as Error).message)
  }
}

// ─── Render 既有資料 ─────────────────────────────────────

/**
 * 節點 label:標題 + 第二行「負責人 · 截止日」(x6 text 支援 \n 換行)。
 * 沒有負責人/截止日就只顯示標題 — 時間線視圖會提醒去補。
 */
function nodeLabel(n: Pick<NodeResponse, 'title' | 'assigneeUserId' | 'deadline'>): string {
  const meta: string[] = []
  if (n.assigneeUserId) meta.push(`👤${n.assigneeUserId}`)
  if (n.deadline) {
    const d = new Date(n.deadline)
    meta.push(`📅${d.getMonth() + 1}/${d.getDate()}`)
  }
  return meta.length ? `${n.title}\n${meta.join(' · ')}` : n.title
}

function renderProject() {
  if (!graph || !detail.value) return
  const nodes = (detail.value.nodes ?? []) as NodeResponse[]
  const edges = (detail.value.edges ?? []) as EdgeResponse[]
  graph.fromJSON({
    nodes: nodes.map((n) => {
      const color = NODE_TYPE_COLOR[n.nodeType] ?? NODE_TYPE_COLOR.task
      return {
        id: String(n.nodeId),
        shape: NODE_SHAPE,
        x: n.positionX,
        y: n.positionY,
        width: n.width || 140,
        height: n.height || 48,
        attrs: {
          body: {fill: color.fill, stroke: color.stroke, strokeWidth: 1, rx: 6, ry: 6},
          label: {text: nodeLabel(n), fontSize: 12, fill: '#262626'},
        },
        data: {synced: true, nodeType: n.nodeType},
      }
    }),
    edges: edges.map((e) => ({
      id: String(e.edgeId),
      source: String(e.sourceNodeId),
      target: String(e.targetNodeId),
      label: e.label,
      attrs: {
        line: {stroke: '#A2B1C3', strokeWidth: 1.5, targetMarker: {name: 'block', width: 8, height: 6}},
      },
    })),
  })
}

// ─── Inspector callbacks ─────────────────────────────────

function closeInspector() {
  selectedNode.value = null
}

/** Inspector 改完欄位後同步:更新 detail.value.nodes + graph label(標題/負責人/截止日都會反映在節點上) */
function onNodeUpdated(patch: Partial<NodeResponse>) {
  if (!selectedNode.value) return
  Object.assign(selectedNode.value, patch)
  const orig = detail.value?.nodes.find((n) => n.nodeId === selectedNode.value!.nodeId)
  if (orig) Object.assign(orig, patch)
  if (graph && ('title' in patch || 'assigneeUserId' in patch || 'deadline' in patch)) {
    const cell = graph.getCellById(String(selectedNode.value.nodeId))
    if (cell?.isNode()) cell.attr('label/text', nodeLabel(selectedNode.value))
  }
}

async function onDeleteSelected() {
  if (!selectedNode.value) return
  const nodeId = selectedNode.value.nodeId
  try {
    await projectFlowApi.deleteNode(nodeId)
    graph?.getCellById(String(nodeId))?.remove()
    if (detail.value) detail.value.nodes = detail.value.nodes.filter((n) => n.nodeId !== nodeId)
    selectedNode.value = null
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ─── Zoom ─────────────────────────────────────────────────

function zoomBy(delta: number) {
  graph?.zoom(delta)
}

function zoomReset() {
  graph?.zoomTo(1)
}

function fitContent() {
  graph?.zoomToFit({padding: 24, maxScale: 1})
}
</script>

<style scoped>
.canvas-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
}

.title {
  margin: 0;
  flex: 0 0 auto;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  margin-left: auto;
  color: #909399;
  font-size: 12px;
}

.body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.stencil {
  width: 200px;
  border-right: 1px solid #e4e7ed;
  background: #fff;
  padding: 12px;
  overflow-y: auto;
}

.stencil-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.stencil-hint {
  font-size: 12px;
  color: #909399;
  margin-bottom: 16px;
}

.stencil-item {
  padding: 14px 12px;
  margin-bottom: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  text-align: center;
  font-size: 13px;
  color: #262626;
  transition: box-shadow 0.15s, transform 0.15s;
}

.stencil-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.stencil-item:active {
  cursor: grabbing;
}

.graph {
  flex: 1;
  overflow: hidden;
}
</style>
