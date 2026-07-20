/** 剝掉 LLM 回應可能包的 markdown ```json 圍欄(daily-advice / 其它 LLM 消費端共用) */
export function stripJsonFence(raw: string): string {
    return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
}
