/**
 * 快速聯繫 API 模塊
 *
 * 提供兩個接口：
 *  1. searchContacts - 根據關鍵詞搜索負責人
 *  2. sendEmail      - 發送郵件給指定聯繫人
 *
 * 兩個接口使用不同的 endpoint（從 configStore.contactConfig 讀取），
 * 支持後端分離部署場景。
 */

import axios from 'axios'
import { createHttpClient } from '../http-client'
import { useConfigStore } from '@/stores/config.store'
import { setupAuthInterceptor } from '../interceptors/auth.interceptor'
import { setupErrorInterceptor } from '../interceptors/error.interceptor'
import type {
  Contact,
  SearchContactsResponse,
  SendEmailRequest,
  SendEmailResponse
} from '@/types/api.types'

/**
 * 快速聯繫 API Composable
 *
 * 注意：searchApiEndpoint 和 emailApiEndpoint 是完整 URL（不只是 path），
 * 因此使用自定義 axios 實例而非 createHttpClient 工廠。
 */
export function useContactApi() {
  const configStore = useConfigStore()
  const contactConfig = configStore.contactConfig

  // 搜索接口使用完整的 searchApiEndpoint 作為請求 URL
  const searchBaseURL = contactConfig?.searchApiEndpoint ?? ''
  // 郵件接口使用完整的 emailApiEndpoint 作為請求 URL
  const emailBaseURL = contactConfig?.emailApiEndpoint ?? ''

  // 為搜索和郵件分別創建 client（endpoint 是完整 URL，baseURL 設為根路徑）
  // 實際請求時直接 post('') 即可命中完整 URL
  const searchClient = axios.create({ baseURL: searchBaseURL, timeout: 10000 })
  const emailClient = axios.create({ baseURL: emailBaseURL, timeout: 15000 })

  // 附加攔截器
  setupAuthInterceptor(searchClient)
  setupErrorInterceptor(searchClient)
  setupAuthInterceptor(emailClient)
  setupErrorInterceptor(emailClient)

  return {
    /**
     * 搜索聯繫人
     * GET {searchApiEndpoint}?q={keyword}
     *
     * @param keyword 搜索關鍵詞（問題描述、業務方向等）
     * @returns 匹配的聯繫人列表
     *
     * @example
     * const contacts = await contactApi.searchContacts('ERP 系統故障')
     */
    async searchContacts(keyword: string): Promise<Contact[]> {
      const { data } = await searchClient.get<SearchContactsResponse>('', {
        params: {
          q: keyword,
          limit: contactConfig?.maxSearchResults ?? 20
        }
      })
      return data.contacts
    },

    /**
     * 發送郵件
     * POST {emailApiEndpoint}
     *
     * @param payload 郵件內容（收件人、主題、正文）
     * @returns 發送結果（含 messageId）
     *
     * @example
     * await contactApi.sendEmail({
     *   to: 'zhangsan@company.com',
     *   toName: '張三',
     *   subject: '關於 ERP 系統故障的詢問',
     *   body: '您好，...'
     * })
     */
    async sendEmail(payload: SendEmailRequest): Promise<SendEmailResponse> {
      const { data } = await emailClient.post<SendEmailResponse>('', payload)
      return data
    }
  }
}
