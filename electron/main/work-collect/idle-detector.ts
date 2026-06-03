/**
 * 閒置判定 — 純業務 Domain 規則。
 *
 * 兩種命中方式:
 *   1. 系統 idle 秒數 ≥ 間隔秒數 - grace(鍵鼠長期無動)
 *   2. dHash 跟上次距離 ≤ 閾值 且 前台視窗未變(畫面未動 = 大概率沒做事)
 */

import {powerMonitor} from 'electron'
import {logger} from '../utils/logger'

/** dHash Hamming 距離 ≤ 此值視為畫面未變(64 bit 容忍 ~15%) */
const HASH_SIMILAR_THRESHOLD = 10
/** idle 判定 grace 秒數,抗 setInterval 漂移 */
const IDLE_GRACE_SECONDS = 5

export class IdleDetector {
    private lastHash: string | null = null
    private lastActiveTitle: string | null = null

    detect(currentHash: string, activeTitle: string, intervalSec: number): boolean {
        const idleThreshold = Math.max(1, intervalSec - IDLE_GRACE_SECONDS)
        const idleSec = powerMonitor.getSystemIdleTime()
        const dist = this.lastHash && this.lastActiveTitle === activeTitle
            ? hammingHex(this.lastHash, currentHash)
            : null
        // 每 tick 都印,放 debug 不落庫(避免淹沒 DB)
        logger.debug(
            `idle 判定 idleSec=${idleSec}/${idleThreshold} dist=${dist ?? 'n/a'}/${HASH_SIMILAR_THRESHOLD}`,
            'IdleDetector',
        )
        if (idleSec >= idleThreshold) return true
        return dist !== null && dist <= HASH_SIMILAR_THRESHOLD
    }

    rememberState(hash: string, activeTitle: string): void {
        this.lastHash = hash
        this.lastActiveTitle = activeTitle
    }
}

/** 兩個 16-hex dHash 的 Hamming 距離(內部使用) */
function hammingHex(a: string, b: string): number {
    if (a.length !== b.length) return 64
    let d = 0
    for (let i = 0; i < a.length; i += 2) {
        let x = parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16)
        while (x) {
            d += x & 1
            x >>>= 1
        }
    }
    return d
}
