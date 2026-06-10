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
 * 改設定 = 改這個檔 + 改 @shared/types/config/* 對應型別;不再有 JSON 雙來源同步問題。
 */

import {app} from 'electron'
import type {AppConfig} from '@shared/types/config'

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
        {id: 'home', label: '首頁', icon: 'House', routeName: 'home', enabled: true},
        {id: 'unified-platform', label: '系統整理', icon: 'Grid', routeName: 'unified-platform', enabled: true},
      {id: 'internal-functions', label: '內部功能', icon: 'Grid', routeName: 'internal-functions', enabled: true},
        {id: 'personal-functions', label: '個人', icon: 'User', routeName: 'personal-functions', enabled: true},
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
        {
            id: 'menu-go-platform',
            label: '系統整理',
            icon: 'Grid',
            enabled: true,
            separator: false,
            action: {type: 'navigate', routeName: 'unified-platform'}
        },
      {id: 'menu-go-internal', label: '內部功能',   icon: 'Grid',         enabled: true, separator: false, action: {type: 'navigate', routeName: 'internal-functions'}},
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
              description: '本機截圖 → AI 分析 → 工作分類流水線與圖表',
              icon: 'Aim',
              enabled: true,
              openMode: 'page',
              routeName: 'work-collect',
          },
          // 項目流程(docs/20)— 主入口,從這裡進列表後再導到畫布 / 匯報 / 備忘錄 / 團隊
          {
              id: 'projectFlow',
              name: '項目流程',
              description: '流程圖 + 工作匯報 + 備忘錄 + 團隊視圖',
              icon: 'Connection',
              enabled: true,
              openMode: 'page',
              routeName: 'project-flow',
          },
          {
              id: 'projectReports',
              name: '工作匯報',
              description: '撰寫並提交週 / 日報,支援 AI 草稿',
              icon: 'Document',
              enabled: true,
              openMode: 'page',
              routeName: 'project-reports',
          },
          {
              // 備忘錄走獨立窗(docs/20 §5.5 + user 反饋:不要嵌在主流程內)
              id: 'projectMemos',
              name: '備忘錄',
              description: '個人待辦,獨立窗口隨手叫出',
              icon: 'Memo',
              enabled: true,
              openMode: 'window',
              windowId: 'memos',
          },
          {
              id: 'projectTeam',
              name: '團隊視圖',
              description: '主管查看下屬匯報與備忘錄',
              icon: 'User',
              enabled: true,
              openMode: 'page',
              routeName: 'project-team',
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
      // 模板化:server 下發,null=未綁(scheduler 不啟動)
      categoryTemplateId: null,
      templateName: null,
  },
  notification: {
    // 遠程通知(docs/18):啟用後 desktop 主動連 tmbom SignalR Hub,IT 端可推訊息 / 派發腳本
    enabled: true,
      //
      // **必須 http:// 開頭,不是 ws://**:
      //   @microsoft/signalr 的 HubConnectionBuilder.withUrl 內部 _resolveUrl 只認得 http/https,
      //   碰到 ws:// 又因 electron main process 沒 window 物件,會 throw `Cannot resolve`。
      //   SignalR 會在握手後自己升級成 WebSocket,我們給它 HTTP URL 就行。
      //
    // dev / prod 自動切:對齊 .env.* 的 VITE_WORK_COLLECT_API_URL 規則。
      //   - dev (electron-vite dev) :app.isPackaged=false → http://localhost:5247
      //   - prod (electron-builder 打包後):app.isPackaged=true → http://192.168.120.79:9004
    // 標記為 dev-owned,resync 啟動時會強制覆寫成這個值(改值改這裡 + 重啟即可,不會被 user 鎖死)
      wsUrl: app.isPackaged ? 'http://192.168.120.79:9004' : 'http://localhost:5247',
    pingIntervalMs: 30_000,
    reconnectMaxMs: 30_000,
  },
}
