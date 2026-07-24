/**
 * 讀取桌面寵物 sprite 幀 → base64 data URL(給浮球 renderer 用)。
 *
 * 素材在 resources/<folder>/,每資料夾內:
 *   <action>_NN_background_removed.png  ← 用這些(背景已去除)
 *   raw_<action>_NN_background_removed.png ← 原圖,略過
 * 走 resolveResourcePath 兼容 dev(專案根)/ prod(extraResources 拷貝出的 resources)。
 *
 * 一次性讀取(進入寵物模式時 renderer invoke 一次),共 ~21 個小檔,同步讀可接受。
 * 任一資料夾讀失敗只記 log 並回空陣列,不讓整包掛掉(該動作退化為不播)。
 */

import {readdirSync, readFileSync} from 'fs'
import {join} from 'path'
import {logger} from './utils/logger'
import {resolveResourcePath} from './utils/resources-path'
import type {PetFrames} from '../shared/types/pet.types'

/** 動作 → resources 資料夾名 */
const FOLDER_MAP: Record<keyof PetFrames, string> = {
    idle: 'idlenoback',
    hover: 'hovernoback',
    grab: 'grabnoback',
    drag: 'dragnoback',
    drop: 'dropnoback',
    poke: 'pokenoback',
}

/** 讀單一資料夾的幀 → base64 data URL 陣列(檔名升序;略過 raw_) */
function loadFolder(folder: string): string[] {
    try {
        const dir = resolveResourcePath(folder)
        const files = readdirSync(dir)
            .filter((f) => f.toLowerCase().endsWith('.png') && !f.startsWith('raw_'))
            .sort()  // 檔名 <action>_00.. 補零,字典序即數字序
        return files.map((f) => {
            const b64 = readFileSync(join(dir, f)).toString('base64')
            return `data:image/png;base64,${b64}`
        })
    } catch (err) {
        logger.warn(`寵物幀讀取失敗 folder=${folder}`, 'PetFrames', err)
        return []
    }
}

/** 讀齊 6 個動作的所有幀 */
export function readPetFrames(): PetFrames {
    return {
        idle: loadFolder(FOLDER_MAP.idle),
        hover: loadFolder(FOLDER_MAP.hover),
        grab: loadFolder(FOLDER_MAP.grab),
        drag: loadFolder(FOLDER_MAP.drag),
        drop: loadFolder(FOLDER_MAP.drop),
        poke: loadFolder(FOLDER_MAP.poke),
    }
}
