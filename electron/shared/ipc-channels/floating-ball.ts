/**
 * 浮動小球相關 IPC channels。
 */
export const FloatingBallChannels = {
  /** 顯示浮球(主視窗隱藏時呼叫) */
  BALL_SHOW: 'floating-ball:show',
  /** 隱藏浮球(主視窗顯示時呼叫,避免遮擋) */
  BALL_HIDE: 'floating-ball:hide',
  /** 浮球 mousedown:開始拖動 */
  BALL_START_DRAG: 'floating-ball:start-drag',
  /** 浮球 mouseup:結束拖動 + 觸發邊緣吸附 */
  BALL_STOP_DRAG: 'floating-ball:stop-drag',
  /** 查詢浮球座標。invoke。返回:{ x, y } */
  BALL_GET_POSITION: 'floating-ball:get-position',
  /** 浮球右鍵彈出原生菜單 */
  BALL_SHOW_CONTEXT_MENU: 'floating-ball:show-context-menu',

  /** PUSH:浮球菜單 / 托盤菜單觸發路由跳轉,主進程推給渲染端 */
  PUSH_BALL_NAVIGATE: 'floating-ball:navigate',
} as const
