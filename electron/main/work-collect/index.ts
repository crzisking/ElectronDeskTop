/**
 * work-collect 主進程模組 barrel。
 *
 * 對外只暴露 WorkCollectorScheduler;其餘協作者(CaptureService / IdleDetector /
 * SyncCoordinator / prompt-builder / time-utils)是內部實作,需要時各自具名 import。
 */

export {WorkCollectorScheduler} from './scheduler'
export {WorkCollectSyncService} from './sync-service'
