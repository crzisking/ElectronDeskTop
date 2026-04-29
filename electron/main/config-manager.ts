/**
 * 配置管理器
 *
 * 職責：
 *  1. 應用啟動時從磁盤讀取 app-config.json
 *  2. 若 userData 目錄不存在配置文件，自動從應用資源目錄複製默認配置
 *  3. 將配置解析並提供給 IPC Handler 使用
 *  4. （可選）監聽文件變化，熱更新時推送到渲染進程
 *
 * 配置文件路徑：
 *  - 開發環境：項目根目錄 config/app-config.json
 *  - 生產環境：{app.getPath('userData')}/app-config.json
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { logger } from './utils/logger'
import type { AppConfig } from '../../src/types/config.types'

/**
 * 代碼兜底默認配置。
 *
 * 僅在以下情況使用：
 *  1. 開發環境找不到 config/app-config.json
 *  2. 生產環境 extraResources 複製失敗且 userData 也無配置
 *
 * ⚠️ 注意：生產環境正常情況下會直接讀取 app-config.json（見 load() 方法），
 * 此處的值只作為最後兜底，保持與 app-config.json 同步即可。
 */
const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',
  app: {
    language: 'zh-TW',
    theme: 'system',
    startMinimized: false,
    launchOnStartup: false
  },
  sidebar: {
    defaultCollapsed: false,
    items: [
      { id: 'unified-platform',  label: '統一平台',      icon: 'Grid',     routeName: 'unified-platform',  enabled: true },
      { id: 'internal-functions', label: '內部功能',     icon: 'Grid',     routeName: 'internal-functions', enabled: true },
      { id: 'business',           label: '業務安排與尋找', icon: 'DataLine', routeName: 'business',           enabled: true }
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
      { id: 'go-platform',  label: '統一平台',      icon: 'Grid',        action: { type: 'navigate', routeName: 'unified-platform' }, enabled: true  },
      { id: 'go-internal',  label: '內部功能',      icon: 'Grid',        action: { type: 'navigate', routeName: 'internal-functions' }, enabled: true },
      { id: 'go-business',  label: '業務安排與尋找', icon: 'DataLine',   action: { type: 'navigate', routeName: 'business' },         enabled: true  },
      { id: 'sep-2',        label: '',              action: { type: 'show-main-window' },                                             enabled: true, separator: true },
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
  business: {
    pipelineApiEndpoint: '',
    ownerSearchApiEndpoint: '',
    maxSearchResults: 20
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
  /** 當前加載的配置（初始化後永不為 null） */
  private config: AppConfig = DEFAULT_CONFIG

  /** 配置文件在磁盤上的完整路徑 */
  private readonly configFilePath: string

  constructor() {
    // 開發環境：使用項目根目錄下的 config/ 文件夾
    // 生產環境：使用 userData 目錄（每個系統用戶獨立的應用數據目錄）
    if (app.isPackaged) {
      this.configFilePath = join(app.getPath('userData'), 'app-config.json')
    } else {
      // __dirname 在開發時指向 electron/main/，所以需要上兩級到達項目根
      this.configFilePath = join(app.getAppPath(), 'config', 'app-config.json')
    }

    logger.info(`配置文件路徑: ${this.configFilePath}`, 'ConfigManager')
  }

  /**
   * 加載配置文件
   * 1. 生產環境：每次啟動都從 extraResources 覆蓋 userData 配置（保證版本升級後配置與代碼同步）
   * 2. 讀取配置文件並解析 JSON
   * 3. 與默認配置深合並（確保新增字段有默認值）
   */
  async load(): Promise<void> {
    try {
      // 生產環境下，每次啟動都從安裝包覆蓋 userData 配置，
      // 確保版本升級後路由名稱、菜單等始終與當前代碼一致。
      // （用戶不會手動編輯此文件，因此直接覆蓋是安全的。）
      if (app.isPackaged) {
        await this.copyDefaultConfig()
      }

      // 讀取並解析配置文件
      if (existsSync(this.configFilePath)) {
        const raw = readFileSync(this.configFilePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppConfig>
        // 深合並：用戶配置覆蓋默認值，確保缺失字段有默認值
        this.config = this.deepMerge(DEFAULT_CONFIG, parsed) as AppConfig
        logger.info('配置文件加載成功', 'ConfigManager')
      } else {
        // 開發環境可能沒有配置文件，使用默認配置
        logger.warn('配置文件不存在，使用默認配置', 'ConfigManager')
        this.config = DEFAULT_CONFIG
      }
    } catch (err) {
      logger.error('配置文件加載失敗，使用默認配置', 'ConfigManager', err)
      this.config = DEFAULT_CONFIG
    }
  }

  /** 獲取當前配置（只讀副本） */
  getConfig(): AppConfig {
    return this.config
  }

  /**
   * 獲取自動更新配置子集。
   * 與直接讀 config.update 的差別：
   *  - 對 update 節點缺失（舊版 app-config.json）做 fallback，避免 undefined
   *  - UpdateManager 不需要關心整個 AppConfig，依賴面更窄
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
   * 寫入部分配置（深合並後保存到磁盤）
   * @param partial 要更新的配置字段
   */
  async writeConfig(partial: Partial<AppConfig>): Promise<void> {
    try {
      this.config = this.deepMerge(this.config, partial) as AppConfig
      // 確保目錄存在
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

  /** 生產環境下，從 extraResources 複製默認配置到 userData */
  private async copyDefaultConfig(): Promise<void> {
    try {
      // process.resourcesPath 指向 electron-builder 打包的 resources 目錄
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
   * 深合並工具函數
   * 遞歸合並兩個對象，source 中的值覆蓋 target 中的值
   * 數組不進行深合並（直接替換）
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
