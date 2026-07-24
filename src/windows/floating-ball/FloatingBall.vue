<script lang="ts" setup>
/**
 * 浮球 / 桌面寵物主體。
 *
 * 兩種造型(config.floatingBall.mode,右鍵菜單可切換,主進程推 PUSH_BALL_MODE_CHANGED):
 *  - 'ball' 圓形浮球(原樣):左鍵點擊顯主窗、拖動、右鍵原生菜單
 *  - 'pet'  桌面寵物:同樣可拖動 / 點擊 / 右鍵,額外用滑鼠事件驅動 sprite 動畫
 *           hover(移上去)/ grab(按下)/ drag(拖動中)/ drop(放下)/ poke(點一下)
 *
 * 拖動仍走主進程 startDrag/stopDrag(~60fps 移窗);動畫純在 renderer 播,兩者獨立。
 * 視窗尺寸由主進程依 mode 調整(ball 80 / pet 180),此處只填滿並置中。
 */

import {onMounted, onUnmounted, ref} from 'vue'
import {IpcChannels} from '@shared/ipc-channels'
import {usePetAnimator} from './usePetAnimator'

type Mode = 'ball' | 'pet'

const mode = ref<Mode>('ball')
const isDragging = ref(false)

const animator = usePetAnimator()
const petFrame = animator.currentFrame

/** 拖動判定閾值:按住超過此時間(ms)且移動超過此距離(px)才算拖動 */
const DRAG_TIME_THRESHOLD = 200
const DRAG_DISTANCE_THRESHOLD = 5

let mousedownTime = 0
let mousedownX = 0
let mousedownY = 0
let hasMoved = false
/** 是否處於一次「按下→放開」週期中(避免拖動途中滑鼠離開觸發 hover→idle) */
let pressing = false

// ── 造型模式:初始讀 config + 訂閱切換推播 ──────────────────────
const onModeChanged = (m: unknown) => applyMode(m as Mode)

async function applyMode(next: Mode): Promise<void> {
  mode.value = next
  if (next === 'pet') {
    await animator.ensureLoaded()
    animator.play('idle')
  }
}

onMounted(async () => {
  window.electronAPI.on(IpcChannels.PUSH_BALL_MODE_CHANGED, onModeChanged)
  try {
    const cfg = await window.electronAPI.config.read()
    await applyMode((cfg?.floatingBall?.mode as Mode) ?? 'ball')
  } catch {
    // 讀失敗維持預設 ball
  }
})

onUnmounted(() => {
  window.electronAPI.off(IpcChannels.PUSH_BALL_MODE_CHANGED, onModeChanged)
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('mouseup', onWindowMouseup)
  animator.dispose()
})

// ── 滑鼠互動 ────────────────────────────────────────────────────
function onMousedown(event: MouseEvent) {
  if (event.button !== 0) return

  mousedownTime = Date.now()
  mousedownX = event.clientX
  mousedownY = event.clientY
  hasMoved = false
  pressing = true
  isDragging.value = false

  window.electronAPI.floatingBall.startDrag()
  if (mode.value === 'pet') animator.play('grab')

  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('mouseup', onWindowMouseup)
}

function onWindowMousemove(event: MouseEvent) {
  const elapsed = Date.now() - mousedownTime
  const dx = event.clientX - mousedownX
  const dy = event.clientY - mousedownY
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (elapsed > DRAG_TIME_THRESHOLD && distance > DRAG_DISTANCE_THRESHOLD) {
    if (!hasMoved && mode.value === 'pet') animator.play('drag')  // 首次判定為拖動 → 切拖動動畫
    hasMoved = true
    isDragging.value = true
  }
}

function onWindowMouseup() {
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('mouseup', onWindowMouseup)
  window.electronAPI.floatingBall.stopDrag()

  if (mode.value === 'pet') {
    animator.play(hasMoved ? 'drop' : 'poke')  // 拖動→落下;點擊→戳(皆自動回 idle)
  }

  // 未移動視為點擊:顯示主窗(兩種造型一致)
  if (!hasMoved) window.electronAPI.window.show()

  pressing = false
  isDragging.value = false
}

/** 滑鼠移上去:寵物播 hover(非拖動中才播) */
function onMouseenter() {
  if (mode.value === 'pet' && !pressing) animator.play('hover')
}

/** 滑鼠離開:寵物回 idle(非拖動中才切) */
function onMouseleave() {
  if (mode.value === 'pet' && !pressing) animator.play('idle')
}

function onContextmenu(event: MouseEvent) {
  event.preventDefault()
  window.electronAPI.showContextMenu()
}
</script>

<template>
  <div
      :class="{ 'is-dragging': isDragging, 'is-pet': mode === 'pet' }"
      class="stage"
      @contextmenu="onContextmenu"
      @mousedown="onMousedown"
      @mouseenter="onMouseenter"
      @mouseleave="onMouseleave"
  >
    <!-- 桌面寵物:sprite 逐幀 -->
    <img
        v-if="mode === 'pet'"
        :src="petFrame"
        alt="pet"
        class="pet-img"
        draggable="false"
    />
    <!-- 傳統浮球:白底圓 + 公司 Logo -->
    <div v-else class="ball">
      <img alt="ichia" class="ball-img" src="@/assets/logo.png"/>
    </div>
  </div>
</template>

<style scoped>
/* 舞台:填滿視窗並置中(視窗尺寸由主進程依 mode 決定) */
.stage {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
}

.stage.is-dragging {
  cursor: grabbing;
}

/* 圓形浮球 */
.ball {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ball-img {
  width: 75%;
  height: 75%;
  object-fit: contain;
  pointer-events: none;
}

/* 寵物 sprite:填滿舞台、等比,禁止拖曳殘影 */
.pet-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  -webkit-user-drag: none;
}
</style>
