/**
 * 浮動小球相關 IPC channels。
 */
export const FloatingBallChannels = {
  /** 浮球 mousedown:開始拖動 */
  BALL_START_DRAG: 'floating-ball:start-drag',
  /** 浮球 mouseup:結束拖動 + 觸發邊緣吸附 */
  BALL_STOP_DRAG: 'floating-ball:stop-drag',
  /** 浮球右鍵彈出原生菜單 */
  BALL_SHOW_CONTEXT_MENU: 'floating-ball:show-context-menu',

    /** invoke:取桌面寵物所有動作的 sprite 幀(base64 data URL) */
    BALL_GET_PET_FRAMES: 'floating-ball:get-pet-frames',

  /** PUSH:浮球菜單 / 托盤菜單觸發路由跳轉,主進程推給渲染端 */
  PUSH_BALL_NAVIGATE: 'floating-ball:navigate',

    /** PUSH:造型模式切換(ball/pet),主進程推給浮球 renderer 即時換裝 */
    PUSH_BALL_MODE_CHANGED: 'floating-ball:push:mode-changed',
} as const
