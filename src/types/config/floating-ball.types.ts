/**
 * 浮動小球配置 — app-config.json 的 "floatingBall" 區塊。
 */
export interface FloatingBallConfig {
  /** 浮球直徑(px),推薦 48-72,預設 60 */
  size: number

  /** 浮球透明度(0-1),預設 0.9 */
  opacity: number

  /** 浮球首次顯示的螢幕座標(相對螢幕左上角,px) */
  defaultPosition: {x: number; y: number}

  /**
   * 拖動停止後是否自動吸附最近的螢幕邊緣。
   * true:鬆開鼠標後浮球滑動到邊緣(常見設計,防止擋住螢幕中央)。
   */
  snapToEdge: boolean

  /**
   * 右鍵菜單項列表。
   * 用於主進程的 showContextMenu IPC handler,使用 Electron Menu.buildFromTemplate()
   * 構建原生菜單。
   */
  quickMenu: QuickMenuItem[]
}

/**
 * quickMenu 陣列的單一菜單項。
 *
 * 對應 JSON:
 *   { "id": "show-main", "label": "打開主窗口", "icon": "Monitor",
 *     "action": { "type": "show-main-window" }, "enabled": true, "separator": false }
 */
export interface QuickMenuItem {
  /** 唯一標識符(列表 key) */
  id: string

  /** 顯示文字(分隔線項可以為空字串) */
  label: string

  /** Element Plus 圖標名稱(可選) */
  icon?: string

  /** 點擊後執行的操作(判別聯合類型,見 QuickMenuAction) */
  action: QuickMenuAction

  /** 是否啟用 */
  enabled: boolean

  /** 是否在此項後渲染分隔線(可選) */
  separator?: boolean
}

/**
 * 浮球快捷菜單操作類型(判別聯合 / Discriminated Union)。
 *
 * 每個成員都有共同的 type 字段且值唯一,TS 透過 type 自動推斷出具體成員型別。
 * 分派場景:主進程 ipc-handlers/index.ts 經 Menu.popup() 處理 action.type。
 *
 * 對應 JSON 範例:
 *   { "type": "show-main-window" }
 *   { "type": "navigate", "routeName": "internal-functions" }
 *   { "type": "open-url", "url": "https://example.com", "target": "browser" }
 *   { "type": "quit-app" }
 */
export type QuickMenuAction =
  | {type: 'show-main-window'}
  | {type: 'navigate'; routeName: string}
  | {type: 'open-url'; url: string; target: 'browser' | 'iframe'}
  | {type: 'quit-app'}
    | { type: 'open-agent' }
