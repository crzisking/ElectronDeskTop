/**
 * 主進程 idea-capture 內部型別。
 * 後端 PagedResult<List<T>> 經 ASP.NET 預設 camelCase 序列化後的形狀。
 */
export interface PagedResult<T> {
    pageIndex: number
    pageSize: number
    total: number
    list: T
}
