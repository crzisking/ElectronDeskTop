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
const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',
  app: {
    language: 'zh-TW',
    startMinimized: false,
    launchOnStartup: false
  },
  sidebar: {
    defaultCollapsed: false,
    items: [
      {id: 'unified-platform', label: '統一平台', icon: 'Grid', routeName: 'unified-platform', enabled: true},
      {id: 'internal-functions', label: '內部功能', icon: 'Grid', routeName: 'internal-functions', enabled: true}
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
  update: {
    enabled: false,
    feedUrl: 'http://192.168.120.135:10001/',
    channel: 'latest',
    dailyCheckTime: '11:00',
    autoDownload: true,
    autoInstallOnAppQuit: false
  }
}

export class ConfigManager {
  /** 當前配置（初始化後永不為 null） */
  private config: AppConfig = DEFAULT_CONFIG

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
   * 生產環境每次啟動都從 extraResources 覆蓋 userData，確保版本升級後配置與代碼同步。
   */
  async load(): Promise<void> {
    try {
      // 用戶不會手動編輯此檔，直接覆蓋是安全的
      if (app.isPackaged) {
        await this.copyDefaultConfig()
      }

      if (existsSync(this.configFilePath)) {
        const raw = readFileSync(this.configFilePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppConfig>
        // 深合並確保新增字段有默認值
        this.config = this.deepMerge(DEFAULT_CONFIG, parsed) as AppConfig
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

  /** 取當前配置 */
  getConfig(): AppConfig {
    return this.config
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
      this.config = this.deepMerge(this.config, partial) as AppConfig
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
