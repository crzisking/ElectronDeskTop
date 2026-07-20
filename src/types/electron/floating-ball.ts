/**
 * electronAPI.floatingBall 子介面 — 浮球控制。
 *
 * show/hide 由主窗或托盤觸發;拖動 API 由浮球自己的 mousedown/mouseup 呼叫,
 * 主進程接管後以 ~60fps 輪詢游標位置移動窗口,放掉時觸發邊緣吸附動畫。
 */

export interface FloatingBallAPI {
    /**
     * 開始拖動浮球。呼叫後主進程以 ~60fps 輪詢游標位置更新浮球位置。
     * 必須在 mousedown 事件中呼叫。
     */
    startDrag: () => void

    /**
     * 停止拖動浮球。停止輪詢並觸發邊緣吸附動畫。
     * 必須在 mouseup 事件中呼叫。
     */
    stopDrag: () => void
}
