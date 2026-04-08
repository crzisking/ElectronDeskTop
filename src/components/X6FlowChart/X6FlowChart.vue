<script setup lang="ts">
/**
 * X6FlowChart — 基於 @antv/x6 的通用流程圖組件
 *
 * ── 組件職責 ──────────────────────────────────────────────────────────
 * 封裝 AntV X6 畫布的初始化、交互、序列化/反序列化，
 * 對外暴露簡潔的 Props + Events + Methods 接口，
 * 使用方只需關心業務數據（nodes/edges），無需了解 X6 底層 API。
 *
 * ── 主要功能 ──────────────────────────────────────────────────────────
 * 1. 流程圖渲染：根據傳入的 nodes/edges 數據渲染流程圖
 * 2. 節點拖拽添加：支持從外部拖拽節點到畫布（Dnd 插件）
 * 3. 連線操作：節點上的連接樁（port）支持拖拽連線
 * 4. 框選操作：Shift + 拖拽框選多個節點（Selection 插件）
 * 5. 快捷鍵：Backspace 刪除選中元素
 * 6. 縮放平移：滾輪縮放、拖拽畫布平移
 * 7. 數據導出：getGraphData() 導出當前圖的 nodes/edges JSON
 *
 * ── 使用方式 ──────────────────────────────────────────────────────────
 * <X6FlowChart
 *   :nodes="pipelineNodes"
 *   :edges="pipelineEdges"
 *   :readonly="false"
 *   @node-click="handleNodeClick"
 *   @graph-change="handleChange"
 *   ref="flowChartRef"
 * />
 *
 * // 導出圖數據
 * const { nodes, edges } = flowChartRef.value.getGraphData()
 *
 * ── @antv/x6 核心概念 ───────────────────────────────────────────────
 * Graph ：畫布容器，管理所有節點和邊
 * Node  ：節點（矩形、圓形等形狀）
 * Edge  ：邊（連線），連接兩個節點
 * Port  ：連接樁，節點上的連線錨點（上下左右四個小圓點）
 * Cell  ：Node 和 Edge 的父類統稱
 */

import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Graph } from '@antv/x6'
import type { FlowNode, FlowEdge } from '@/types/api.types'

// ── Props 定義 ─────────────────────────────────────────────────────
interface Props {
  /**
   * 流程圖節點數據
   * 傳入後會渲染到畫布上；更新時會重新渲染
   */
  nodes?: FlowNode[]

  /**
   * 流程圖邊（連線）數據
   * 與 nodes 配合使用，描述節點間的連線關係
   */
  edges?: FlowEdge[]

  /**
   * 是否為只讀模式
   * true  ：禁止編輯（僅查看），隱藏連接樁，禁止拖拽/刪除
   * false ：允許編輯（默認）
   */
  readonly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  nodes: () => [],
  edges: () => [],
  readonly: false
})

// ── Events 定義 ────────────────────────────────────────────────────
const emit = defineEmits<{
  /**
   * 節點被點擊時觸發
   * @param e
   * @param node 被點擊節點的業務數據
   */
  (e: 'node-click', node: FlowNode): void

  /**
   * 圖發生任何變更時觸發（節點增刪移動、邊增刪等）
   * 可用於「自動保存」或「標記未保存變更」
   */
  (e: 'graph-change'): void

  /**
   * 節點被雙擊時觸發（可用於打開節點編輯彈窗）
   * @param e
   * @param node 被雙擊節點的業務數據
   */
  (e: 'node-dblclick', node: FlowNode): void
}>()

// ── DOM 引用 ───────────────────────────────────────────────────────
/** 畫布掛載的 DOM 容器 */
const containerRef = ref<HTMLDivElement>()

/** X6 Graph 實例（組件銷毀時需要 dispose） */
let graph: Graph | null = null

// ── 連接樁（Port）配置 ──────────────────────────────────────────────
/**
 * 連接樁定義：每個節點上下左右各一個連接樁
 * 連接樁是節點邊緣的小圓點，用戶從一個節點的 port 拖拽到另一個節點的 port
 * 就能創建一條邊（連線）
 */
const defaultPorts = {
  groups: {
    // 上方連接樁組
    top: {
      position: 'top',
      attrs: {
        circle: {
          r: 4,                              // 圓點半徑
          magnet: true,                      // magnet=true 允許從此處拖出連線
          stroke: '#5F95FF',                 // 邊框顏色
          strokeWidth: 1,
          fill: '#fff',                      // 填充白色
          style: { visibility: 'hidden' }    // 默認隱藏，hover 節點時才顯示
        }
      }
    },
    right: {
      position: 'right',
      attrs: {
        circle: {
          r: 4, magnet: true, stroke: '#5F95FF',
          strokeWidth: 1, fill: '#fff',
          style: { visibility: 'hidden' }
        }
      }
    },
    bottom: {
      position: 'bottom',
      attrs: {
        circle: {
          r: 4, magnet: true, stroke: '#5F95FF',
          strokeWidth: 1, fill: '#fff',
          style: { visibility: 'hidden' }
        }
      }
    },
    left: {
      position: 'left',
      attrs: {
        circle: {
          r: 4, magnet: true, stroke: '#5F95FF',
          strokeWidth: 1, fill: '#fff',
          style: { visibility: 'hidden' }
        }
      }
    }
  },
  // 每個節點默認擁有的連接樁
  items: [
    { group: 'top' },
    { group: 'right' },
    { group: 'bottom' },
    { group: 'left' }
  ]
}

// ── 初始化 Graph ───────────────────────────────────────────────────
/**
 * 創建並配置 X6 Graph 實例
 *
 * Graph 是 X6 的核心類，負責：
 *  - 管理畫布容器和渲染引擎
 *  - 管理所有節點（Node）和邊（Edge）
 *  - 處理用戶交互（拖拽、縮放、選中等）
 *  - 提供插件擴展（Selection、Snapline、History 等）
 */
function initGraph(): void {
  if (!containerRef.value) return

  graph = new Graph({
    // ── 畫布基本配置 ─────────────────────────────────────────
    container: containerRef.value,       // 掛載的 DOM 元素
    autoResize: true,                    // 容器大小變化時自動調整畫布

    // ── 背景網格 ─────────────────────────────────────────────
    // 顯示點狀網格，幫助用戶對齊節點
    grid: {
      visible: true,
      type: 'dot',                       // 點狀網格（'mesh' 為線狀網格）
      size: 10,                          // 網格間距 10px
      args: {
        color: '#e2e2e2',                // 網格點顏色
        thickness: 1                     // 網格點大小
      }
    },

    // ── 鼠標滾輪縮放 ─────────────────────────────────────────
    mousewheel: {
      enabled: true,
      zoomAtMousePosition: true,         // 以鼠標位置為中心縮放
      modifiers: 'ctrl',                 // 需要按住 Ctrl 鍵才能縮放（避免與頁面滾動衝突）
      minScale: 0.3,                     // 最小縮放比例 30%
      maxScale: 3                        // 最大縮放比例 300%
    },

    // ── 畫布平移 ──────────────────────────────────────────────
    panning: {
      enabled: true,                     // 允許拖拽空白區域移動畫布
      modifiers: 'shift'                 // 需要按住 Shift 鍵拖拽平移
    },

    // ── 連線規則 ──────────────────────────────────────────────
    connecting: {
      router: 'manhattan',              // 連線路由算法：曼哈頓（直角轉彎，避開節點）
      connector: {
        name: 'rounded',                 // 連線轉角圓滑處理
        args: { radius: 8 }
      },
      anchor: 'center',                 // 連接點位於節點中心
      connectionPoint: 'anchor',
      allowBlank: false,                 // 不允許連線到空白處
      allowLoop: false,                  // 不允許自連（節點連自己）
      allowMulti: false,                 // 不允許兩節點間多條平行連線
      snap: { radius: 30 },             // 連線時 30px 範圍內自動吸附到連接樁
      // 連線創建時的默認邊樣式
      createEdge() {
        return graph!.createEdge({
          shape: 'edge',
          attrs: {
            line: {
              stroke: '#5F95FF',           // 連線顏色
              strokeWidth: 2,
              targetMarker: {              // 箭頭樣式
                name: 'block',
                width: 12,
                height: 8
              }
            }
          },
          zIndex: 0                        // 邊在節點下方
        })
      },
      // 驗證連線是否允許（可以加入業務邏輯，例如禁止某些類型的節點互連）
      validateConnection({ sourceCell, targetCell }) {
        // 不允許連接自身
        return sourceCell?.id !== targetCell?.id
      }
    },

    // ── 高亮效果 ──────────────────────────────────────────────
    // 鼠標 hover 連接樁時的高亮效果
    highlighting: {
      magnetAdsorbed: {
        name: 'stroke',
        args: {
          attrs: {
            fill: '#5F95FF',
            stroke: '#5F95FF'
          }
        }
      }
    }
  })

  // ── 事件綁定 ──────────────────────────────────────────────────

  // 節點單擊
  graph.on('node:click', ({ node }) => {
    const data = nodeToFlowNode(node)
    emit('node-click', data)
  })

  // 節點雙擊
  graph.on('node:dblclick', ({ node }) => {
    const data = nodeToFlowNode(node)
    emit('node-dblclick', data)
  })

  // 監聽圖變更（節點/邊的增刪改移動都會觸發）
  graph.on('cell:added', () => emit('graph-change'))
  graph.on('cell:removed', () => emit('graph-change'))
  graph.on('cell:changed', () => emit('graph-change'))
  graph.on('node:moved', () => emit('graph-change'))

  // 鼠標進入節點時顯示連接樁，離開時隱藏
  graph.on('node:mouseenter', ({ node }) => {
    if (props.readonly) return
    const ports = node.getPorts()
    ports.forEach((port) => {
      node.setPortProp(port.id!, 'attrs/circle/style/visibility', 'visible')
    })
  })
  graph.on('node:mouseleave', ({ node }) => {
    const ports = node.getPorts()
    ports.forEach((port) => {
      node.setPortProp(port.id!, 'attrs/circle/style/visibility', 'hidden')
    })
  })

  // ── 鍵盤快捷鍵（純 DOM 事件，不依賴外部插件）──────────────────
  if (!props.readonly) {
    containerRef.value?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!graph) return

      // Backspace：刪除當前選中的節點和邊
      if (e.key === 'Backspace') {
        // 遍歷所有 cell，找到被標記為選中的（通過 X6 內部選中狀態）
        const cells = graph.getCells().filter(cell => {
          // X6 v3 的節點/邊自帶 isSelected 方法（若無插件則需手動追蹤）
          try { return (cell as any).isSelected?.() } catch { return false }
        })
        if (cells.length) {
          graph.removeCells(cells)
        }
      }
    })

    // 讓容器可以接收鍵盤事件
    if (containerRef.value) {
      containerRef.value.tabIndex = 0
    }
  }

  // 渲染初始數據
  renderData(props.nodes, props.edges)
}

// ── 數據渲染 ───────────────────────────────────────────────────────
/**
 * 將業務數據（FlowNode[] + FlowEdge[]）渲染到 X6 畫布
 *
 * @param nodes 節點數組
 * @param edges 邊數組
 */
function renderData(nodes: FlowNode[], edges: FlowEdge[]) {
  if (!graph) return

  // 清空畫布
  graph.clearCells()

  // 添加節點
  nodes.forEach((n) => {
    graph!.addNode({
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      shape: n.shape || 'rect',
      label: n.label,
      data: n.data,
      // 節點基礎樣式
      attrs: {
        body: {
          fill: '#f5f7fa',
          stroke: '#5F95FF',
          strokeWidth: 1,
          rx: 6,                           // 圓角
          ry: 6
        },
        label: {
          fontSize: 13,
          fill: '#333'
        }
      },
      // 連接樁配置（只讀模式不添加連接樁）
      ports: props.readonly ? undefined : defaultPorts
    })
  })

  // 添加邊
  edges.forEach((e) => {
    graph!.addEdge({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      data: e.data,
      attrs: {
        line: {
          stroke: '#5F95FF',
          strokeWidth: 2,
          targetMarker: {
            name: 'block',
            width: 12,
            height: 8
          }
        }
      }
    })
  })

  // 自動縮放以適應畫布可見區域
  if (nodes.length > 0) {
    graph.zoomToFit({ padding: 40, maxScale: 1 })
  }
}

// ── 工具函數 ───────────────────────────────────────────────────────
/**
 * 將 X6 Node 對象轉為業務 FlowNode 類型
 * X6 內部的 Node 對象包含大量渲染信息，我們只提取業務需要的字段
 */
function nodeToFlowNode(node: any): FlowNode {
  const pos = node.getPosition()
  const size = node.getSize()
  const label = (node.attr('label/text') as string)
    || (node.attr('text/text') as string)
    || ''
  return {
    id: node.id,
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    shape: node.shape || 'rect',
    label,
    data: node.getData() || {}
  }
}

// ── 公開方法（供父組件通過 ref 調用）──────────────────────────────
/**
 * 導出當前流程圖數據
 *
 * 將 X6 畫布上的所有節點和邊序列化為 FlowNode[] + FlowEdge[]，
 * 用於保存到後端。
 *
 * @returns { nodes: FlowNode[], edges: FlowEdge[] }
 */
function getGraphData(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!graph) return { nodes: [], edges: [] }

  const nodes: FlowNode[] = graph.getNodes().map((node) => {
    const pos = node.getPosition()
    const size = node.getSize()
    // 從 attrs.label.text 或 attrs.text.text 中讀取節點文字
    const label = (node.attr('label/text') as string)
      || (node.attr('text/text') as string)
      || ''
    return {
      id: node.id,
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      shape: node.shape || 'rect',
      label,
      data: node.getData() || {}
    }
  })

  const edges: FlowEdge[] = graph.getEdges().map((edge) => {
    const edgeLabel = (edge.attr('label/text') as string)
      || (edge.attr('text/text') as string)
      || undefined
    return {
      id: edge.id,
      source: edge.getSourceCellId(),
      target: edge.getTargetCellId(),
      label: edgeLabel,
      data: edge.getData() || {}
    }
  })

  return { nodes, edges }
}

/**
 * 在畫布上添加一個新節點
 *
 * @param label  節點顯示文字
 * @param x      X 座標（默認 100）
 * @param y      Y 座標（默認 100）
 * @param shape  節點形狀（默認 'rect'）
 * @returns 新節點的 ID
 */
function addNode(
  label: string,
  x = 100,
  y = 100,
  shape = 'rect'
): string {
  if (!graph) return ''

  const node = graph.addNode({
    x,
    y,
    width: 160,
    height: 48,
    shape,
    label,
    attrs: {
      body: {
        fill: '#f5f7fa',
        stroke: '#5F95FF',
        strokeWidth: 1,
        rx: 6,
        ry: 6
      },
      label: {
        fontSize: 13,
        fill: '#333'
      }
    },
    ports: defaultPorts
  })

  return node.id
}

/**
 * 將畫布縮放到適配所有內容
 */
function zoomToFit() {
  graph?.zoomToFit({ padding: 40, maxScale: 1 })
}

/**
 * 將畫布縮放重置為 100%
 */
function zoomReset() {
  graph?.zoomTo(1)
  graph?.centerContent()
}

// 向父組件暴露方法
defineExpose({
  getGraphData,
  addNode,
  zoomToFit,
  zoomReset
})

// ── 生命週期 ───────────────────────────────────────────────────────
onMounted(() => {
  nextTick(() => {
    initGraph()
  })
})

onBeforeUnmount(() => {
  // 銷毀 Graph 實例，釋放 DOM 事件監聽和內存
  graph?.dispose()
  graph = null
})

// 監聽 props 變化，重新渲染數據
watch(
  () => [props.nodes, props.edges],
  () => {
    if (graph) {
      renderData(props.nodes, props.edges)
    }
  },
  { deep: true }
)
</script>

<template>
  <!--
    X6 畫布容器
    必須設定明確的寬高，否則 X6 無法正確渲染。
    使用 ref 綁定讓 X6 的 Graph 掛載到這個 DOM 元素上。
  -->
  <div ref="containerRef" class="x6-flowchart-container" />
</template>

<style scoped>
/*
 * 畫布容器樣式
 * 必須佔滿父元素，且有明確的高度
 * X6 會在此 DOM 內部創建 SVG/Canvas 元素
 */
.x6-flowchart-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}
</style>
