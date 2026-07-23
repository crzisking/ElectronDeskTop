/**
 * 窗口控制 / 應用退出 / 跨窗口導航相關 IPC channels。
 */
export const WindowChannels = {
  /** 主視窗最小化 */
  WINDOW_MINIMIZE: 'window:minimize',
  /** 主視窗最大化(切換) */
  WINDOW_MAXIMIZE: 'window:maximize',
  /** 主視窗關閉(預設不退出,進 tray) */
  WINDOW_CLOSE: 'window:close',
  /** 主視窗顯示(從 tray / 浮球喚回) */
  WINDOW_SHOW: 'window:show',
  /** 主視窗隱藏(進 tray,保留浮球) */
  WINDOW_HIDE: 'window:hide',
  /** 查詢主視窗是否最大化。invoke。返回:boolean */
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  /**
   * OPEN_CHILD_WINDOW:從統一平台卡片打開外部 URL 的子視窗。
   * 主進程內白名單校驗。
   */
  OPEN_CHILD_WINDOW: 'window:open-child',

    /** 打開 AI Agent 獨立窗(docs/19)。invoke,無 payload;已開則 focus。 */
    WINDOW_OPEN_AGENT: 'window:open-agent',

    /** 打開靈感速記速記小窗(docs/21)。invoke,無 payload;已開則 show+focus。 */
    WINDOW_OPEN_IDEA_CAPTURE: 'window:open-idea-capture',

  /** PUSH:主視窗最大化 / 還原狀態變動推送 */
  PUSH_WINDOW_MAXIMIZED: 'push:window-maximized',
} as const
