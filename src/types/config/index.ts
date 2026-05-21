/**
 * 應用配置型別統一出口。
 *
 * 對應 config/app-config.json 的根結構,各區塊型別拆檔放在這個目錄下:
 *   app.types.ts                ─ AppSettings
 *   sidebar.types.ts            ─ SidebarConfig, SidebarItem
 *   system-links.types.ts       ─ SystemLinksConfig, SystemLinkItem
 *   floating-ball.types.ts      ─ FloatingBallConfig, QuickMenuItem, QuickMenuAction
 *   unified-platform.types.ts   ─ UnifiedPlatformConfig, SystemLink
 *   internal-functions.types.ts ─ InternalFunctionsConfig, InternalTool
 *   update.types.ts             ─ UpdateConfig
 *   work-collect.types.ts       ─ WorkCollectConfig
 *
 * 為什麼拆檔:單檔 685 行太肥,每個 feature 自己一份小檔好維護;
 * 統一從 '@/types/config.types' 或 '@/types/config' import 都行(後者解析到 index.ts)。
 */

import type {AppSettings} from './app.types'
import type {SidebarConfig} from './sidebar.types'
import type {SystemLinksConfig} from './system-links.types'
import type {FloatingBallConfig} from './floating-ball.types'
import type {UnifiedPlatformConfig} from './unified-platform.types'
import type {InternalFunctionsConfig} from './internal-functions.types'
import type {UpdateConfig} from './update.types'
import type {WorkCollectConfig} from './work-collect.types'

/**
 * 完整應用配置根接口 — 對應 config/app-config.json 的頂層結構。
 */
export interface AppConfig {
  /**
   * 應用版本號(只讀)。
   * 由主進程 ConfigManager.getConfig() 從 app.getVersion()(package.json 的 version)動態注入,
   * 不寫入 app-config.json,也不可透過 CONFIG_WRITE 修改。
   * 唯一真實源:package.json,這樣 electron-updater 比對版本和 UI 顯示版本永遠一致。
   */
  version: string

  /** 全局應用設置 */
  app: AppSettings

  /** 左側邊欄菜單配置 */
  sidebar: SidebarConfig

  /** 側邊欄『系統』分組外部連結配置 */
  systemLinks: SystemLinksConfig

  /** 浮動小球配置 */
  floatingBall: FloatingBallConfig

  /** 統一平台頁面配置 */
  unifiedPlatform: UnifiedPlatformConfig

  /** 內部功能配置 */
  internalFunctions: InternalFunctionsConfig

  /** 自動更新配置 */
  update: UpdateConfig

  /** 工作採集配置 */
  workCollect: WorkCollectConfig
}

// ── re-export 子型別,讓 `from '@/types/config.types'` 仍可拿到所有型別 ──
export type {AppSettings} from './app.types'
export type {SidebarConfig, SidebarItem} from './sidebar.types'
export type {SystemLinksConfig, SystemLinkItem} from './system-links.types'
export type {FloatingBallConfig, QuickMenuItem, QuickMenuAction} from './floating-ball.types'
export type {UnifiedPlatformConfig, SystemLink} from './unified-platform.types'
export type {InternalFunctionsConfig, InternalTool} from './internal-functions.types'
export type {UpdateConfig} from './update.types'
export type {WorkCollectConfig} from './work-collect.types'
