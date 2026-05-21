/**
 * 應用配置讀寫管理（app-config.json）。
 * 用於：electron/main/index.ts 啟動時 load() + ConfigHandlers IPC。
 * 路徑：dev=專案根 config/app-config.json，prod=userData/app-config.json。
 */

import {app} from 'electron'
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs'
import {dirname, join} from 'path'
import {logger} from './utils/logger'
import type {AppConfig} from '../../src/types/config.types'

/**
 * 代碼兜底默認配置。
 * 僅在 dev 缺檔 / prod 複製失敗且 userData 也無檔時使用。
 * 注意：正常情況直接讀 app-config.json，此處保持與其同步即可。
 */
// version 由 app.getVersion() 在 getConfig() 時動態注入，唯一真實源是 package.json
// 這裡用 as 斷言補上類型，避免 DEFAULT_CONFIG 缺 version 編譯不過
const DEFAULT_CONFIG = {
  app: {
    language: 'zh-TW',
    startMinimized: false,
    launchOnStartup: false
  },
  sidebar: {
    defaultCollapsed: false,
    items: [
      {id: 'unified-platform',   label: '統一平台', icon: 'Grid', routeName: 'unified-platform',   enabled: true},
      {id: 'internal-functions', label: '內部功能', icon: 'Grid', routeName: 'internal-functions', enabled: true},
      {id: 'personal-functions', label: '個人功能', icon: 'User', routeName: 'personal-functions', enabled: true}
    ]
  },
  systemLinks: {
    items: [
      {id: 'docs-center', label: '文檔中心', icon: 'Document', url: 'http://192.168.120.135:10002/', enabled: true}
    ]
  },
  floatingBall: {
    size: 60,
    opacity: 0.9,
    defaultPosition: { x: 100, y: 300 },
    snapToEdge: true,
    quickMenu: [
      { id: 'show-main',    label: '打開主窗口',    icon: 'Monitor',     action: { type: 'show-main-window' },                       enabled: true  },
      { id: 'sep-1',        label: '',              action: { type: 'show-main-window' },                                             enabled: true, separator: true },
      {
        id: 'go-platform',
        label: '統一平台',
        icon: 'Grid',
        action: {type: 'navigate', routeName: 'unified-platform'},
        enabled: true
      },
      {
        id: 'go-internal',
        label: '內部功能',
        icon: 'Grid',
        action: {type: 'navigate', routeName: 'internal-functions'},
        enabled: true
      },
      {id: 'sep-2', label: '', action: {type: 'show-main-window'}, enabled: true, separator: true},
      { id: 'quit',         label: '退出應用',      icon: 'SwitchButton', action: { type: 'quit-app' },                              enabled: true  }
    ]
  },
  unifiedPlatform: { systems: [] },
  internalFunctions: {
    apiBaseUrl: '',
    apiTimeout: 30000,
    tools: [
      { id: 'bpmUserFinder', name: 'bpm負責人查詢', description: '查找對應的bpm表單負責人', icon: 'Edit',  enabled: true, openMode: 'page', routeName: 'ai-bpm-finder', url: '' },
      { id: 'itRepair',      name: 'IT 報修',       description: '提交設備故障或 IT 問題',  icon: 'Tools', enabled: true, openMode: 'page', routeName: 'it-repair' }
    ]
  },
  // 個人功能 — sidebar 第三個主功能,放工作採集 / 代辦事項等
  personalFunctions: {
    tools: [
      { id: 'workCollect', name: '工作自動採集', description: '每 5 分鐘自動分析螢幕內容', icon: 'Aim', enabled: true, openMode: 'page', routeName: 'work-collect' }
    ]
  },
  update: {
    enabled: false,
    feedUrl: 'http://192.168.120.135:10001/',
    channel: 'latest',
    dailyCheckTime: '11:00',
    autoDownload: true,
    autoInstallOnAppQuit: false
  },
  // 工作自動採集 — 預設關閉,使用者在內部功能頁開啟才生效
  workCollect: {
    enabled: false,
    intervalMinutes: 5,
    workStartHour: 8,
    workEndHour: 17
  }
} as Omit<AppConfig, 'version'>

export class ConfigManager {
  /** 當前配置（初始化後永不為 null）；version 在 getConfig() 動態注入 */
  private config: Omit<AppConfig, 'version'> = DEFAULT_CONFIG

  /** 配置文件磁盤路徑 */
  private readonly configFilePath: string

  constructor() {
    if (app.isPackaged) {
      this.configFilePath = join(app.getPath('userData'), 'app-config.json')
    } else {
      this.configFilePath = join(app.getAppPath(), 'config', 'app-config.json')
    }

    logger.info(`配置文件路徑: ${this.configFilePath}`, 'ConfigManager')
  }

  /**
   * 加載配置文件並與 DEFAULT_CONFIG 深合並。
   *
   * 生產環境僅在 userData/app-config.json 不存在時(首次安裝 / 用戶手動刪除),才從 extraResources 複製預設。
   * 之前版本「每次啟動都覆蓋」會把 IPC `CONFIG_WRITE` 寫入的使用者設定(WorkCollect 開關、
   * 浮球位置、語言偏好等)清掉,等同設定永遠救不回來。
   *
   * 版本升級的「新增 config 欄位」由 deepMerge(DEFAULT_CONFIG, parsed) 處理,
   * 不需要靠覆蓋整個檔案。
   */
  async load(): Promise<void> {
    try {
      if (app.isPackaged && !existsSync(this.configFilePath)) {
        await this.copyDefaultConfig()
      }

      if (existsSync(this.configFilePath)) {
        const raw = readFileSync(this.configFilePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppConfig>
        // 即便舊版 JSON 仍有 version 字段也忽略，version 改由 app.getVersion() 注入
        if ('version' in parsed) delete (parsed as Record<string, unknown>).version
        // 深合並確保新增字段有默認值
        this.config = this.deepMerge(DEFAULT_CONFIG, parsed) as Omit<AppConfig, 'version'>
        logger.info('配置文件加載成功', 'ConfigManager')
      } else {
        logger.warn('配置文件不存在，使用默認配置', 'ConfigManager')
        this.config = DEFAULT_CONFIG
      }
    } catch (err) {
      logger.error('配置文件加載失敗，使用默認配置', 'ConfigManager', err)
      this.config = DEFAULT_CONFIG
    }
  }

  /**
   * 取當前配置；version 字段在此處從 app.getVersion() 注入，
   * 所以渲染端讀到的版本永遠等於 package.json 裡 electron-builder 打包用的版本。
   */
  getConfig(): AppConfig {
    return { ...this.config, version: app.getVersion() }
  }

  /**
   * 取自動更新子配置。
   * 對舊版 app-config.json 缺 update 節點做 fallback，避免 undefined。
   */
  getUpdateConfig(): AppConfig['update'] {
    return this.config.update ?? {
      enabled: false,
      feedUrl: 'http://192.168.120.135:10001/',
      channel: 'latest',
      dailyCheckTime: '11:00',
      autoDownload: true,
      autoInstallOnAppQuit: false
    }
  }

  /**
   * 寫入部分配置（深合並後保存到磁盤）。
   * @param partial 要更新的配置字段
   */
  async writeConfig(partial: Partial<AppConfig>): Promise<void> {
    try {
      // version 不寫文件（運行時從 app.getVersion() 提供）
      if ('version' in partial) delete (partial as Record<string, unknown>).version
      this.config = this.deepMerge(this.config, partial) as Omit<AppConfig, 'version'>
      const dir = dirname(this.configFilePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8')
      logger.info('配置文件已保存', 'ConfigManager')
    } catch (err) {
      logger.error('配置文件保存失敗', 'ConfigManager', err)
      throw err
    }
  }

  /** 生產環境：從 extraResources 複製默認配置到 userData */
  private async copyDefaultConfig(): Promise<void> {
    try {
      const defaultConfigPath = join(process.resourcesPath, 'app-config.json')
      if (existsSync(defaultConfigPath)) {
        const dir = dirname(this.configFilePath)
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
        copyFileSync(defaultConfigPath, this.configFilePath)
        logger.info('已複製默認配置到 userData', 'ConfigManager')
      }
    } catch (err) {
      logger.warn('複製默認配置失敗', 'ConfigManager', err)
    }
  }

  /**
   * 遞歸深合並，source 覆蓋 target。
   * 數組直接替換，不深合並。
   */
  private deepMerge(target: unknown, source: unknown): unknown {
    if (source === null || source === undefined) return target
    if (typeof source !== 'object' || Array.isArray(source)) return source
    if (typeof target !== 'object' || Array.isArray(target)) return source

    const result = { ...(target as Record<string, unknown>) }
    const src = source as Record<string, unknown>

    for (const key of Object.keys(src)) {
      if (key in result && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = this.deepMerge(result[key], src[key])
      } else {
        result[key] = src[key]
      }
    }

    return result
  }
}
