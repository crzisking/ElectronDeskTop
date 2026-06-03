/**
 * 時間區間過濾 — 給 view 用來把 store.records 縮成「今天」/「本週」子集。
 */

import type {WorkRecord} from '../types'
import {startOfToday, startOfWeek} from './_shared'

export function filterTodayRecords(records: WorkRecord[]): WorkRecord[] {
    const start = startOfToday()
    return records.filter((r) => r.capturedAt >= start)
}

export function filterWeekRecords(records: WorkRecord[]): WorkRecord[] {
    const start = startOfWeek()
    return records.filter((r) => r.capturedAt >= start)
}
