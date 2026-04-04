<script setup lang="ts">
import {Graph, Scroller, Snapline} from '@antv/x6'
import {onMounted, onBeforeUnmount, ref} from 'vue'

const containerRef = ref<HTMLDivElement | null>(null)

let graph: Graph | null = null

onMounted(() => {
  if (!containerRef.value) return

  graph = new Graph({
    container: containerRef.value,
    autoResize: true,
    background: {
      color: '#F2F7FA',
    },
    panning: true,//啟用拖動
    mousewheel: true//啟用滑鼠滾輪
  })
  //使用對齊線
  graph.use(
      new Snapline({
        enabled: true,
      }),
  )
  // Scroller 插件可以使画布支持滚动
  graph.use(
      new Scroller({
        enabled: true,
        pannable: true,
      }),
  )
})

onBeforeUnmount(() => {
  graph?.dispose()
})
</script>

<template>
  <div style="width:100%; height:100%">
    <div ref="containerRef"></div>
  </div>
</template>

<style scoped>

</style>
