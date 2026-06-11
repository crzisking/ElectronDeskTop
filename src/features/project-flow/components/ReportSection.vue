<!--
  匯報單一分區 — 統一渲染「今日工作 / 遇到的問題 / 明日計畫」三段中的任一段。

  關聯節點:每筆 item 可選 [項目 → 節點] 兩級。
   - 後端 ReportItem.projectId / nodeId 本就支援
   - 主管看下屬匯報時,點關聯節點可直接跳到該流程節點的進度視圖(docs/20 §5.6)
   - AI 生成時 suggestedProjectId / suggestedNodeId 也走這兩個欄位
   - cascader 走 lazy load,避免一次抓所有項目的節點(N+1)
-->
<template>
  <section class="section">
    <header class="sec-header">
      <span class="sec-title">{{ icon }} {{ title }}</span>
      <el-tag effect="plain" size="small" type="info">{{ items.length }}</el-tag>
      <el-button
          v-if="!readonly"
          link
          size="small"
          type="primary"
          @click="$emit('add')"
      >+ {{ $t('common.add') }}
      </el-button>
    </header>

    <el-empty v-if="!items.length" :description="emptyText" :image-size="60"/>

    <div
        v-for="item in items"
        :key="(item.itemId || 0) + '-' + item.sortOrder"
        class="item-row"
    >
      <div class="item-main">
        <el-input
            v-model="item.content"
            :disabled="readonly"
            :placeholder="placeholder"
            :rows="2"
            resize="none"
            type="textarea"
        />
        <div class="item-footer">
          <!-- 關聯項目 → 節點(後端 projectId / nodeId)。lazy load,clearable -->
          <el-cascader
              :disabled="readonly"
              :model-value="cascaderValueOf(item)"
              :options="rootOptions"
              :placeholder="$t('projectFlow.reports.linkNode')"
              :props="cascaderProps"
              class="link-cascader"
              clearable
              size="small"
              @change="(v) => onLinkChange(item, v)"
          />
        </div>
      </div>

      <div class="row-actions">
        <el-checkbox
            v-if="showNeedHelp"
            v-model="item.needHelp"
            :disabled="readonly"
            size="small"
        >
          {{ $t('projectFlow.reports.needHelp') }}
        </el-checkbox>
        <el-button
            :disabled="readonly"
            link
            size="small"
            type="danger"
            @click="$emit('remove', item)"
        >
          {{ $t('common.delete') }}
        </el-button>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import type {CascaderProps, CascaderValue} from 'element-plus'
import {projectFlowApi} from '../api'
import type {NodeResponse, ReportItemResponse} from '../types'

defineProps<{
  title: string
  icon: string
  items: ReportItemResponse[]
  readonly: boolean
  showNeedHelp: boolean
  placeholder: string
  emptyText: string
}>()

defineEmits<{
  add: []
  remove: [item: ReportItemResponse]
}>()

interface CascaderOption {
  value: number
  label: string
  leaf?: boolean
  children?: CascaderOption[]

  // EP 的 CascaderOption 帶 string index signature,cast 相容用
  [key: string]: unknown
}

/**
 * cascader 根節點是 [] — 第一次展開時 lazyLoad(node.root=true)拉項目列表。
 * 用 ref([]) 代替 rootOptions 是因為要動態 push;EP cascader 偵測 options 變更會 re-render。
 *
 * 注意:cascader lazyLoad 的二級節點要 cache,展開過的 project 不要重抓。
 *      EP 內部會把 children 寫進 node.children,第二次展開就直接讀,免重複 API。
 */
const rootOptions = ref<CascaderOption[]>([])

// EP 的 CascaderProps.lazyLoad 簽名用內部 Node 型別,自訂簡化簽名需 cast
const cascaderProps = {
  lazy: true,
  checkStrictly: false,
  emitPath: true,
  async lazyLoad(node: {
    root: boolean;
    value?: number;
    data?: CascaderOption
  }, resolve: (data: CascaderOption[]) => void) {
    try {
      if (node.root) {
        // 第一次展開,拉項目列表
        const r = await projectFlowApi.listProjects({pageIndex: 1, pageSize: 100})
        const opts: CascaderOption[] = (r?.list ?? []).map((p) => ({
          value: p.projectId,
          label: p.name,
          leaf: false,
        }))
        rootOptions.value = opts
        resolve(opts)
      } else {
        // 展開某項目,拉它的節點
        const projectId = node.value ?? node.data?.value
        if (!projectId) return resolve([])
        const detail = await projectFlowApi.getProject(projectId)
        const opts: CascaderOption[] = (detail?.nodes ?? []).map((n: NodeResponse) => ({
          value: n.nodeId,
          label: n.title,
          leaf: true,
        }))
        resolve(opts)
      }
    } catch {
      // API 失敗時給空,UI 顯示 "No data";cascader 不會炸
      resolve([])
    }
  },
} as CascaderProps

function cascaderValueOf(item: ReportItemResponse): (number | null)[] {
  // cascader 期待 [projectId, nodeId];任一為空就視為未選
  if (item.projectId && item.nodeId) return [item.projectId, item.nodeId]
  return []
}

function onLinkChange(item: ReportItemResponse, value: CascaderValue | null | undefined) {
  // emitPath=true → 選中時是 [projectId, nodeId];清除時 EP 回 null/undefined
  const path = Array.isArray(value) ? value : null
  if (!path || path.length < 2) {
    item.projectId = undefined
    item.nodeId = undefined
  } else {
    item.projectId = (path[0] as number) ?? undefined
    item.nodeId = (path[1] as number) ?? undefined
  }
}
</script>

<style scoped>
.section {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 16px;
}

.sec-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.sec-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.item-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-footer {
  display: flex;
  gap: 8px;
  align-items: center;
}

.link-cascader {
  max-width: 320px;
}

.row-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  padding-top: 4px;
  min-width: 110px;
}
</style>
