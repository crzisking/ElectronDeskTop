<script setup lang="ts">
/**
 * 浮球主體組件
 *
 * 渲染可拖動的圓形浮球，處理：
 *  - 左鍵單擊：顯示主窗口
 *  - 左鍵按住拖動：通知主進程開始/停止拖動
 *  - 右鍵：觸發 showMenu 事件（由父組件顯示快捷菜單）
 *
 * 拖動原理：
 *  mousedown → electronAPI.floatingBall.startDrag()
 *  主進程以 60fps 輪詢游標位置並更新窗口位置
 *  mouseup → electronAPI.floatingBall.stopDrag()
 *  鬆開後觸發邊緣吸附動畫
 *
 * 注意：不使用 -webkit-app-region: drag（會吞噬點擊事件）
 */

import { ref } from 'vue'

// 右鍵菜單改用原生 Menu（由主進程彈出），不再需要 emit
// 原因：浮球窗口僅 60×60px，Vue 覆蓋層會被窗口邊界裁剪

/** 是否正在拖動（用於樣式反饋） */
const isDragging = ref(false)

/**
 * 判斷是單擊還是拖動
 * 記錄 mousedown 時間，mouseup 時若 < 200ms 則視為點擊
 */
let mousedownTime = 0
let hasMoved = false

function onMousedown(event: MouseEvent) {
  // 只處理左鍵
  if (event.button !== 0) return

  mousedownTime = Date.now()
  hasMoved = false
  isDragging.value = false

  // 通知主進程開始監聽游標位置（開始拖動準備）
  window.electronAPI.floatingBall.startDrag()
}

function onMousemove() {
  if (Date.now() - mousedownTime > 150) {
    hasMoved = true
    isDragging.value = true
  }
}

function onMouseup() {
  // 通知主進程停止拖動（觸發邊緣吸附）
  window.electronAPI.floatingBall.stopDrag()

  // 若沒有移動（視為點擊）：顯示主窗口
  if (!hasMoved) {
    window.electronAPI.window.show()
  }

  isDragging.value = false
}

/** 右鍵：請求主進程彈出原生 context menu */
function onContextmenu(event: MouseEvent) {
  event.preventDefault()
  window.electronAPI.showContextMenu()
}
</script>

<template>
  <div
    class="floating-ball"
    :class="{ 'is-dragging': isDragging }"
    @mousedown="onMousedown"
    @mousemove="onMousemove"
    @mouseup="onMouseup"
    @contextmenu="onContextmenu"
  >
    <!-- 浮球內容：公司 Logo -->
    <img class="ball-img" src="../assets/logo.png" alt="ichia" />

  </div>
</template>

<style scoped>
.floating-ball {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.2),
    0 2px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  transition: transform 0.15s, box-shadow 0.15s;
  position: relative;
}

.floating-ball:hover {
  transform: scale(1.08);
  box-shadow:
    0 6px 20px rgba(0, 0, 0, 0.25),
    0 4px 10px rgba(0, 0, 0, 0.15);
}

/* 拖動中 */
.floating-ball.is-dragging {
  cursor: grabbing;
  transform: scale(0.95);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* 浮球內 Logo 圖片 */
.ball-img {
  width: 75%;
  height: 75%;
  object-fit: contain;
  pointer-events: none;
}
</style>
