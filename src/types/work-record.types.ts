/**
 * 工作採集相關型別,從主進程 schema re-export。
 * 跨 main / renderer 邊界只能 import type,runtime 不會把主進程代碼帶進渲染端。
 */
export type {WorkCategory, WorkRecord, NewWorkRecord} from '../../electron/main/db/schema/work-records'
