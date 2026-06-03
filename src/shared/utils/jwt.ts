/**
 * JWT 工具 —— 解析 ichia portal 簽發的 JWT 並映射為前端 UserProfile。
 *
 * 用途：AD 自動登入流程中,後端 ad-token 接口只回傳一條 JWT 字串,
 *      不像 /api/portal/oauth/login 會附帶 user 物件。此工具負責從
 *      JWT payload 抽出 user 欄位,讓 authStore.user 仍能正常填充。
 *
 * 為什麼集中放這裡:
 *  - 全應用其他地方都把 token 當不透明字串使用,不解析 payload
 *  - AD 流程是唯一需要解析的場景,集中在這支模組,避免 JWT 解析邏輯散落
 *  - 若未來 token 結構變動,只需動這一支
 *
 * 安全性:
 *  - 此處的解析僅用於本地展示(side bar 名字、語言偏好等)
 *  - 不做簽名驗證 —— 簽名驗證是後端的責任,前端拿到 token 直接信任
 *  - JWT payload 為 Base64URL 編碼的 JSON,jwt-decode 套件零依賴解析
 */

import {jwtDecode} from 'jwt-decode'
import type {UserProfile} from '@/types/auth.types'

/**
 * ichia portal JWT payload 結構。
 *
 * 欄位來源:後端 OAuth 簽發 token 時放入的 claims。
 * 標準 JWT claims(exp / nbf / aud / iss)以 lower case;
 * 業務欄位以 PascalCase / gstr 前綴並存,跟後端 C# 命名習慣保持一致。
 *
 * 並非所有欄位都會用到 —— 此處只列出實際讀取的;
 * 其餘欄位以 [key: string]: unknown 容納,避免上游欄位增減時要改 type。
 */
export interface IchiaJwtClaims {
    /** Unix timestamp 秒,token 到期時間 */
    exp: number
    /** Unix timestamp 字串,token 生效時間(後端用字串送) */
    nbf?: string
    /** 組織代碼,如 "ichia" */
    OrgCode?: string
    /** 工號 / AD 帳號,如 "IT006" / "S2403279" */
    UserName?: string
    /** 顯示姓名,如 "趙佳宏" */
    Name?: string
    /** 語言偏好,如 "zh_TW" / "zh_CN" */
    Lang?: string
    /** 主要廠別代碼,如 "3200" */
    Fcty?: string
    /** 廠別類型,如 "EVI" */
    FctyType?: string
    /** 可訪問廠別代碼列表,逗號分隔字串 */
    FctyList?: string
    /** 部門編號 */
    gstrBuNo?: string
    /** 部門名稱 */
    gstrBuName?: string
    /** 業務處描述 */
    gstrBuDesc?: string

    /** 容納上游新增欄位,不需動 type */
    [key: string]: unknown
}

/**
 * 解析 JWT。
 * @param token 完整 JWT 字串(header.payload.signature)
 * @returns 解析出的 claims;格式錯誤回 null。
 */
export function decodeIchiaJwt(token: string): IchiaJwtClaims | null {
    if (!token) return null
    try {
        return jwtDecode<IchiaJwtClaims>(token)
    } catch {
        return null
    }
}

/**
 * 從 JWT claims 拼出前端使用的 UserProfile。
 *
 * 注意:JWT payload 沒有完整 UserProfile 所有欄位(如 email / phoneNo / gender 等),
 *      AD 登入場景下這些欄位填空,UI 展示仍可正常運作(主要用到 name / userName / lang)。
 *      如後續確實需要完整個資,再加一支 GET /user/profile 接口補拉。
 *
 * @param claims decodeIchiaJwt 的結果
 * @returns UserProfile,主要欄位來自 JWT,缺失欄位用合理默認值
 */
export function buildUserProfileFromClaims(claims: IchiaJwtClaims): UserProfile {
    const fctyList = (claims.FctyList ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

    return {
        // JWT 內沒有數值 id,用 0 佔位;若上層需要區分用戶,以 userName 為準
        id: 0,
        userName: claims.UserName ?? '',
        name: claims.Name ?? '',
        // AD 登入的帳號都視為主帳號
        primary: true,
        lang: claims.Lang ?? 'zh_TW',
        fcty: claims.Fcty ?? '',
        fctyList,
        enabled: true,
        deptNo: claims.gstrBuNo ?? '',
        phoneNo: '',
        email: '',
        gender: false,
        genderLabel: ''
    }
}

/**
 * 一步到位:token → UserProfile。
 * 任一步驟失敗返回 null,由上層決定是否降級到 /login。
 */
export function parseUserFromJwt(token: string): UserProfile | null {
    const claims = decodeIchiaJwt(token)
    if (!claims) return null
    // UserName 是最關鍵欄位,缺它視為無效 token
    if (!claims.UserName) return null
    return buildUserProfileFromClaims(claims)
}
