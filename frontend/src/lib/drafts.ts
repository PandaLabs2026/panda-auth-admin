/**
 * MFA step-up 草稿暂存(#26):命中 MFA 门禁会全页跳 /account/mfa,React state 随之清零。
 * 变更 handler 发请求前 saveDraft;回到页面后按实体匹配 consumeDraft 恢复——
 * 草稿不丢,但**不自动重放**(重发由用户显式点击,避免 step-up 回来误触发变更)。
 * sessionStorage:标签页内短命存储,关闭即弃,不进 localStorage。
 */
export function saveDraft<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(`panda.admin.draft.${key}`, JSON.stringify(value))
  } catch {
    // 隐私模式等 sessionStorage 不可用的场景:草稿降级为不暂存,不影响主流程。
  }
}

/** 取出并清除草稿;不存在或解析失败返回 null(消费即弃,避免旧草稿反复弹回)。 */
export function consumeDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`panda.admin.draft.${key}`)
    if (raw === null) return null
    sessionStorage.removeItem(`panda.admin.draft.${key}`)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 变更成功后清除草稿:MFA 才是草稿该存活的场景,成功路径不留残留。 */
export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(`panda.admin.draft.${key}`)
  } catch {
    // 同 saveDraft:存储不可用即无操作。
  }
}
