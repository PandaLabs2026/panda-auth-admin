/**
 * 操作授权流（AUTH-DELIVERY-002，Passkey 退役后的高风险操作门禁）：
 * apiSend 命中 403 mfaGrantRequired 时挂起原请求，把服务端回显的授权参数
 * （operation/targetId/parameters/passwordRequired）交给授权对话框；对话框验证
 * TOTP(+密码)签发授权后 resolveGrant(grantId)，原请求带 X-Panda-Mfa-Grant 头重放，
 * 对页面层完全透明——页面只看到一次最终成功/失败。
 */

export type GrantInfo = {
  operation: string
  targetId: string
  parameters: Record<string, string | null> | null
  passwordRequired: boolean
}

type PendingGrant = GrantInfo & {
  resolve: (grantId: string) => void
  reject: (error: Error) => void
}

let pending: PendingGrant | null = null
type GrantListener = (grant: GrantInfo | null) => void

const listeners = new Set<GrantListener>()

function emit() {
  for (const listener of listeners) listener(pending)
}

export function subscribeGrantDialog(listener: GrantListener): () => void {
  listeners.add(listener)
  listener(pending)
  return () => listeners.delete(listener)
}

/** 当前挂起的授权（宿主组件初始化快照用）。 */
export function currentGrant(): GrantInfo | null {
  return pending
}

/** 挂起原请求并打开授权对话框；resolve 得到授权 id，reject 表示取消。 */
export function beginGrantFlow(info: GrantInfo): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pending = { ...info, resolve, reject }
    emit()
  })
}

/** 对话框签发成功：唤醒挂起的原请求带授权重放。 */
export function resolveGrant(grantId: string) {
  pending?.resolve(grantId)
  pending = null
  emit()
}

/** 对话框取消：原请求以取消错误收场，页面按一般失败展示。 */
export function rejectGrant(error: Error) {
  pending?.reject(error)
  pending = null
  emit()
}
