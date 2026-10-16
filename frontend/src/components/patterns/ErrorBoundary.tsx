import React from "react"

type ErrorBoundaryProps = { children: React.ReactNode }
type ErrorBoundaryState = { error: Error | null }

// 渲染期未捕获异常原本直接白屏;边界兜底后给出可恢复的降级界面,并保留
// 重载入口(会话 cookie 不受影响,刷新即重试)。
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("应用渲染异常", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-lg font-semibold">页面出现了问题</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            界面渲染遇到了未预期的错误。会话仍然有效,重新加载后即可继续。
          </p>
          <button className="rounded-md border px-4 py-2 text-sm" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
