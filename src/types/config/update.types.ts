/**
 * 自動更新配置(electron-updater)— app-config.json 的 "update" 區塊。
 */
export interface UpdateConfig {
  /** 總開關,false 時 update-manager 不啟動 */
  enabled: boolean

  /**
   * 更新源(內網靜態服務器,結尾必須帶 "/")。
   * 服務器需提供 latest.yml + 安裝包 + blockmap。
   */
  feedUrl: string

  /** 發布通道:對應服務器上的 latest.yml / beta.yml / alpha.yml */
  channel: 'latest' | 'beta' | 'alpha'

  /**
   * 每日定時檢查時刻(24h,HH:MM,例如 "11:00")。
   * 啟動時計算「下一次到達該時刻的時間差」並安排首次檢查,之後每 24 小時觸發。
   * 空字串 = 不啟用定時檢查(仍可手動觸發)。
   */
  dailyCheckTime: string

  /**
   * 發現新版時是否自動下載。
   * true:背景自動下載,等用戶在彈窗點「立即重啟」。
   * false:先彈通知問用戶要不要下載。
   */
  autoDownload: boolean

  /**
   * 下載完成後是否在應用退出時靜默安裝。
   * true:用戶下次關閉應用時自動安裝,無需主動點重啟。
   * false:必須用戶主動點「立即重啟」才安裝。
   */
  autoInstallOnAppQuit: boolean
}
