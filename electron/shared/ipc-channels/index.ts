/**
 * IPC Channels 統一出口 — 按 feature 拆檔合成單一物件。
 *
 * 為什麼 spread 合成而不是 namespace:
 *  - 既有所有 consumer 都用 `IpcChannels.XXX` 平坦存取(不是 `IpcChannels.Auth.XXX`),
 *    為了零 breaking change,維持平坦 key。
 *  - feature 拆檔只是視覺分組,執行期仍是一個 const,跟原本完全等價。
 *
 * 新增 channel 步驟:
 *  A. 往**既有 feature** 加 channel:
 *     1. 在對應 feature 檔內加 key/value(例:work-collect.ts 加 WORK_COLLECT_X)
 *     2. 不需要動 index.ts —— spread 會自動帶進來
 *     3. preload 端在 `electron/preload/index.ts` 同步白名單 / bridge 方法
 *
 *  B. 加**全新 feature**(新檔案):
 *     1. 在本目錄新增 <name>.ts,export 對應 Channels const
 *     2. 動 index.ts:加 import + 加進 IpcChannels spread + 加進 re-export
 *     3. preload 端同步
 */

import {AuthChannels} from './auth'
import {ConfigChannels} from './config'
import {WindowChannels} from './window'
import {FloatingBallChannels} from './floating-ball'
import {UpdateChannels} from './update'
import {LogChannels} from './log'
import {WorkCollectChannels} from './work-collect'
import {UserProfileChannels} from './user-profile'
import {SavedCredentialsChannels} from './saved-credentials'
import {WorkAnalysisChannels} from './work-analysis'
import {NotificationChannels} from './notification'
import {ActivityChannels} from './activity'
import {DailyAdviceChannels} from './daily-advice'
import {AgentChannels} from './agent'
import {IdeaCaptureChannels} from './idea-capture'

export const IpcChannels = {
  ...AuthChannels,
  ...ConfigChannels,
  ...WindowChannels,
  ...FloatingBallChannels,
  ...UpdateChannels,
  ...LogChannels,
  ...WorkCollectChannels,
  ...UserProfileChannels,
  ...SavedCredentialsChannels,
  ...WorkAnalysisChannels,
    ...NotificationChannels,
  ...ActivityChannels,
  ...DailyAdviceChannels,
    ...AgentChannels,
    ...IdeaCaptureChannels,
} as const

// 分組常數本身也 export,需要更細粒度的 import 時可以走這條
export {
  AuthChannels,
  ConfigChannels,
  WindowChannels,
  FloatingBallChannels,
  UpdateChannels,
  LogChannels,
  WorkCollectChannels,
  UserProfileChannels,
  SavedCredentialsChannels,
  WorkAnalysisChannels,
    NotificationChannels,
  ActivityChannels,
  DailyAdviceChannels,
    AgentChannels,
    IdeaCaptureChannels,
}
