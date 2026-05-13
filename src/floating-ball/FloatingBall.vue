<script setup lang="ts">
/**
 * 浮球主體組件
 *
 * 渲染可拖動的圓形浮球，處理：
 *  - 左鍵單擊：顯示主窗口
 *  - 左鍵按住拖動：通知主進程開始/停止拖動
 *  - 右鍵：請求主進程彈出原生 context menu
 *
 * 拖動原理：
 *  mousedown → electronAPI.floatingBall.startDrag()
 *  主進程以 60fps 輪詢游標位置並更新窗口位置
 *  mouseup → electronAPI.floatingBall.stopDrag()
 *  鬆開後觸發邊緣吸附動畫
 *
 * 注意：不使用 -webkit-app-region: drag（會吞噬點擊事件）
 *
 * ── 拖動事件策略 ──────────────────────────────────────────────────
 * mousedown 時將 mousemove / mouseup 綁定到 window（而非浮球元素），
 * 避免鼠標移出 80px 的浮球區域後事件丟失導致拖動「卡住」。
 * mouseup 時移除 window 上的監聽器，防止內存泄漏。
 *
 * ── 點擊 vs 拖動判斷 ──────────────────────────────────────────────
 * 同時檢查時間（> 200ms）和距離（> 5px），兩個條件都滿足才算拖動。
 * 只看時間的話，用戶按住不動也會被誤判為拖動，導致點擊失效。
 */

import {ref} from 'vue'

/** 是否正在拖動（用於樣式反饋） */
const isDragging = ref(false)

/** 拖動判定閾值：按住超過此時間（ms）且移動超過此距離（px）才算拖動 */
const DRAG_TIME_THRESHOLD = 200
const DRAG_DISTANCE_THRESHOLD = 5

/** mousedown 時記錄的時間戳 */
let mousedownTime = 0

/** mousedown 時記錄的鼠標坐標，用於計算移動距離 */
let mousedownX = 0
let mousedownY = 0

/** 是否已判定為拖動（移動超過閾值） */
let hasMoved = false

/**
 * 鼠標按下：記錄起始狀態，通知主進程準備拖動，
 * 並將 mousemove / mouseup 綁定到 window 以防止鼠標移出浮球後事件丟失。
 */
function onMousedown(event: MouseEvent) {
  if (event.button !== 0) return

  mousedownTime = Date.now()
  mousedownX = event.clientX
  mousedownY = event.clientY
  hasMoved = false
  isDragging.value = false

  // 通知主進程開始監聽游標位置
  window.electronAPI.floatingBall.startDrag()

  // 綁定到 window：鼠標移出浮球元素後仍能接收事件
  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('mouseup', onWindowMouseup)
}

/**
 * window 上的 mousemove：判斷是否超過拖動閾值（時間 + 距離）。
 * 綁定在 window 上而非浮球元素，確保鼠標移出 80px 區域後仍能追蹤。
 */
function onWindowMousemove(event: MouseEvent) {
  const elapsed = Date.now() - mousedownTime
  const dx = event.clientX - mousedownX
  const dy = event.clientY - mousedownY
  const distance = Math.sqrt(dx * dx + dy * dy)

  // 同時滿足時間和距離閾值才算拖動
  if (elapsed > DRAG_TIME_THRESHOLD && distance > DRAG_DISTANCE_THRESHOLD) {
    hasMoved = true
    isDragging.value = true
  }
}

/**
 * window 上的 mouseup：結束拖動，移除 window 事件監聽器。
 * 若未移動（視為點擊）：顯示主窗口。
 */
function onWindowMouseup() {
  // 移除 window 上的監聽器，防止內存泄漏
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('mouseup', onWindowMouseup)

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
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  position: relative;
}

/* 拖動中：僅切換游標，不縮放，避免被 80×80 視窗邊緣切到 */
.floating-ball.is-dragging {
  cursor: grabbing;
}

/* 浮球內 Logo 圖片 */
.ball-img {
  width: 75%;
  height: 75%;
  object-fit: contain;
  pointer-events: none;
}
</style>
