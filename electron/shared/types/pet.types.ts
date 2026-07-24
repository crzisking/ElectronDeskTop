/**
 * 桌面寵物 sprite 幀資料(跨進程共用型別)。
 *
 * main 讀 resources/<folder>/ 下的背景去除 PNG,base64 編碼成 data URL 陣列,
 * 經 IPC 一次性給 renderer(sandbox 下無法直接讀檔 / file://,故走 base64)。
 * 每個欄位 = 一個動作的逐幀,依檔名數字升序。
 */
export interface PetFrames {
    /** 待機(1 幀靜止) */
    idle: string[]
    /** 滑鼠移上去 */
    hover: string[]
    /** 按下抓起 */
    grab: string[]
    /** 拖曳中 */
    drag: string[]
    /** 放下落地 */
    drop: string[]
    /** 點一下戳它 */
    poke: string[]
}

/** 寵物動作名(PetFrames 的 key) */
export type PetAction = keyof PetFrames
