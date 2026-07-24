/**
 * 桌面寵物 sprite 動畫播放器(事件驅動,非自主)。
 *
 * 每個動作一組逐幀圖(base64,main 經 IPC 給)。play(action) 切狀態:
 *  - loop  動作:循環播放(idle / hover / drag)
 *  - one-shot 動作:播一次停在末幀;若有 next 則自動轉場(grab→hold、drop/poke→idle)
 * 只用 setInterval;idle 是單幀,直接顯示不開 timer(省資源)。
 */

import {ref} from 'vue'
import type {PetAction, PetFrames} from '@shared/types/pet.types'

interface AnimSpec {
    fps: number
    loop: boolean
    /** one-shot 播完自動轉場的下一個動作(loop 動作忽略) */
    next?: PetAction
}

/** 各動作的節奏 / 循環規則(fps 越小越慢;動作切換的節奏也由此決定) */
const ANIM: Record<PetAction, AnimSpec> = {
    idle: {fps: 1.5, loop: true},
    hover: {fps: 3, loop: true},
    grab: {fps: 4, loop: false},            // 抓起:播一次停在末幀,等 drag/drop 接手
    drag: {fps: 3.5, loop: true},
    drop: {fps: 4, loop: false, next: 'idle'},
    poke: {fps: 3.5, loop: false, next: 'idle'},
}

export function usePetAnimator() {
    const currentFrame = ref<string>('')
    const state = ref<PetAction>('idle')
    let frames: PetFrames | null = null
    let loaded = false
    let idx = 0
    let timer: ReturnType<typeof setInterval> | null = null

    /** 進寵物模式時取一次幀;取到就開始待機 */
    async function ensureLoaded(): Promise<void> {
        if (loaded) return
        frames = await window.electronAPI.floatingBall.getPetFrames()
        loaded = true
        play('idle')
    }

    function stopTimer(): void {
        if (timer) {
            clearInterval(timer)
            timer = null
        }
    }

    /** 取某動作的幀;空(讀取失敗)則退回 idle 幀 */
    function frameList(a: PetAction): string[] {
        const f = frames?.[a]
        return f && f.length ? f : (frames?.idle ?? [])
    }

    function play(action: PetAction): void {
        if (!frames) return
        state.value = action
        idx = 0
        stopTimer()
        const list = frameList(action)
        if (!list.length) {
            currentFrame.value = ''
            return
        }
        currentFrame.value = list[0]
        // 單幀(idle):靜止顯示,不開 timer
        if (list.length === 1) return

        const spec = ANIM[action]
        timer = setInterval(() => {
            idx++
            if (idx >= list.length) {
                if (spec.loop) {
                    idx = 0
                } else {
                    // one-shot 播完:停末幀,有 next 就轉場
                    stopTimer()
                    idx = list.length - 1
                    currentFrame.value = list[idx]
                    if (spec.next) play(spec.next)
                    return
                }
            }
            currentFrame.value = list[idx]
        }, 1000 / spec.fps)
    }

    function dispose(): void {
        stopTimer()
    }

    return {currentFrame, state, ensureLoaded, play, dispose}
}
