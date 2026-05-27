/**
 * 程式碼層的預設 config —— **應用唯一的 seed source**。
 *
 * 重構後的角色(方案 A,完全棄用 app-config.json):
 *  1. **Seed 源**:首次啟動 / DB 空時直接寫進各表
 *  2. **Dev-owned resync 基準**:每次啟動 `resyncDevOwnedConfig` 用此清單跟 DB 比對,
 *     dev-owned 部分(全部 collection + 部分 KV)強制覆寫;user-owned 散值保留
 *
 * Runtime 不直接讀此檔(runtime 永遠讀 DB);只有 seed.ts / repository.ts 內部使用。
 *
 * 改設定 = 改這個檔 + 改 src/types/config/* 對應型別;不再有 JSON 雙來源同步問題。
 */

import type {AppConfig} from '../../../../../src/types/config'

/**
 * 程式碼預設 config(不含 version)。version 永遠由 `app.getVersion()` runtime 注入。
 *
 * 這是應用啟動時 DB 為空時的**唯一 seed source**。改設定值改這裡即可。
 */
export const DEFAULT_CONFIG: Omit<AppConfig, 'version'> = {
  app: {
    language: 'zh-TW',
    startMinimized: false,
    // 公司強制策略:開機自啟,使用者不可關。改成 dev-owned,resync 時強制為 true
    launchOnStartup: true,
  },
  sidebar: {
    defaultCollapsed: false,
    items: [
      {id: 'unified-platform',   label: '統一平台', icon: 'Grid', routeName: 'unified-platform',   enabled: true},
      {id: 'internal-functions', label: '內部功能', icon: 'Grid', routeName: 'internal-functions', enabled: true},
      {id: 'personal-functions', label: '個人功能', icon: 'User', routeName: 'personal-functions', enabled: true},
    ],
  },
  systemLinks: {
    items: [
      {id: 'docs-center', label: '文檔中心', icon: 'Document', url: 'http://192.168.120.135:10002/', enabled: true},
    ],
  },
  floatingBall: {
    size: 80,
    opacity: 0.9,
    defaultPosition: {x: 100, y: 300},
    snapToEdge: true,
    quickMenu: [
      {id: 'menu-show-main',   label: '打開主窗口', icon: 'Monitor',     enabled: true, separator: false, action: {type: 'show-main-window'}},
      {id: 'menu-sep-1',       label: '',                                  enabled: true, separator: true,  action: {type: 'show-main-window'}},
      {id: 'menu-go-platform', label: '統一平台',   icon: 'Grid',         enabled: true, separator: false, action: {type: 'navigate', routeName: 'unified-platform'}},
      {id: 'menu-go-internal', label: '內部功能',   icon: 'Grid',         enabled: true, separator: false, action: {type: 'navigate', routeName: 'internal-functions'}},
      {
        id: 'menu-open-agent',
        label: 'AI Agent',
        icon: 'ChatDotRound',
        enabled: true,
        separator: false,
        action: {type: 'open-agent'}
      },
      {id: 'menu-sep-2',       label: '',                                  enabled: true, separator: true,  action: {type: 'show-main-window'}},
      {id: 'menu-quit',        label: '退出應用',   icon: 'SwitchButton', enabled: true, separator: false, action: {type: 'quit-app'}},
    ],
  },
  unifiedPlatform: {
    systems: [
      {
        id: 'sys-erp',
        name: '新ERP 系統',
        description: 'ERP系統',
        url: 'http://192.168.110.122:9996/?returnUrl=http://192.168.120.79:8080/',
        openMode: 'electron-window',
        ssoEnabled: false,
      },
      {
        id: 'sys-bi',
        name: 'BI 數據分析',
        description: '業務報表、數據看板、趨勢分析',
        url: 'http://192.168.20.27:8080/webroot/decision/login?origin=66404fa7-165b-412f-9172-87297ba1b781#/',
        openMode: 'electron-window',
        ssoEnabled: false,
        ssoTokenParam: 'sso_token',
      },
      {
        id: 'sys-fanwei',
        name: '泛微平台',
        description: '泛微',
        url: 'http://192.168.120.84/wui/index.html',
        openMode: 'electron-window',
        ssoEnabled: false,
        ssoTokenParam: 'sso_token',
      },
      {
        id: 'sys-BPM',
        name: 'BPM系統',
        description: 'BPM系統',
        url: 'http://asvspm03.ichia.com/BPM/Login/Index',
        openMode: 'electron-window',
        ssoEnabled: false,
        ssoTokenParam: 'sso_token',
      },
      {
        id: 'sys-it',
        name: 'IT 服務台',
        description: '報修工單、IT 資產、VPN 申請',
        url: 'https://itsm.example.com',
        openMode: 'external-browser',
        ssoEnabled: false,
      },
    ],
  },
  internalFunctions: {
    apiBaseUrl: 'https://api.example.com/ai/v1',
    apiTimeout: 30000,
    tools: [
      {
        id: 'bpmUserFinder',
        name: 'bpm負責人查詢',
        description: '查找對應的bpm表單負責人',
        icon: 'Edit',
        enabled: true,
        openMode: 'page',
        routeName: 'ai-bpm-finder',
        url: 'http://192.168.19.62/chat/5NyfqoZ9lGUWfCf8',
      },
      {
        id: 'AiSop',
        name: 'AiSop生成',
        description: '文字快速生成SOP',
        icon: 'Document',
        enabled: true,
        openMode: 'page',
        routeName: 'ai-sop',
        url: 'http://192.168.19.62/chatbot/3KWtcMfirFwJ50oC',
      },
      {
        id: 'itRepair',
        name: 'IT 報修',
        description: '提交設備故障或 IT 問題，查看自己的工單狀態',
        icon: 'Tools',
        enabled: true,
        openMode: 'page',
        routeName: 'it-repair',
      },
    ],
  },
  personalFunctions: {
    tools: [
      {
        id: 'workCollect',
        name: '工作自動採集',
        description: '每 5 分鐘自動分析螢幕內容，產生個人工作流水線（工時內 + 螢幕未鎖才採集）',
        icon: 'Aim',
        enabled: true,
        openMode: 'page',
        routeName: 'work-collect',
      },
    ],
  },
  update: {
    // 公司強制策略:自動更新必開,使用者不可關
    enabled: true,
    feedUrl: 'http://192.168.120.135:10001/',
    channel: 'latest',
    dailyCheckTime: '11:00',
    autoDownload: true,
    // 公司強制策略:後台靜默安裝(下次退出時自動裝),使用者不可關
    autoInstallOnAppQuit: true,
  },
  workCollect: {
    enabled: false,
    intervalMinutes: 5,
    workStartHour: 8,
    workEndHour: 17,
  },
}
