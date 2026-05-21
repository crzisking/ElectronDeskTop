/**
 * 全局應用設置 — app-config.json 的 "app" 區塊。
 *
 * 注意:本應用只支持單一亮色主題,不提供 theme 切換。
 * 過去保留過 theme 字段但無實際實現,已於 2026-05 統一移除。
 */
export interface AppSettings {
  /**
   * 界面語言(字面量聯合類型)
   *   'zh-TW' ─ 繁體中文(台灣)
   *   'en'    ─ 英文
   * 用於 i18n 國際化配置,設置 vue-i18n 的 locale。
   */
  language: 'zh-TW' | 'en'

  /**
   * 啟動時直接顯示浮球(跳過主窗口)。
   * true:適合「輕量使用者」,直接用浮球快速操作。
   * 用於 electron/main/index.ts 創建窗口時的判斷邏輯。
   */
  startMinimized: boolean

  /**
   * 是否加入系統開機自啟動。
   * Windows 寫註冊表 / macOS 寫 LaunchAgent。
   * 用於主進程透過 app.setLoginItemSettings() 實現。
   */
  launchOnStartup: boolean
}
