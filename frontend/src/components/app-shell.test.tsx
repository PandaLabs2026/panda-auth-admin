import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/app/router"
import { sessionApi } from "@/lib/auth"
import { Providers } from "@/test/utils"

// AppShell 布局组装契约(模板 AppLayout 之上):品牌、导航、身份区账号外链、
// 顶栏常驻件(返回门户/修改密码/语言切换)。

afterEach(() => {
  cleanup()
  localStorage.setItem("panda.admin.lang", "zh-CN")
  vi.restoreAllMocks()
})

function renderShell(session: "prefill" | "fetch" = "fetch") {
  return render(
    <Providers session={session}>
      <AppShell />
    </Providers>,
  )
}

describe("AppShell wiring", () => {
  it("renders PandaAuth brand, admin nav items and the account entry link from the session", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "me").mockResolvedValue({
      displayName: "管理员甲",
      email: "admin@example.com",
      roles: ["admin"],
      accountEntryUrl: "/me",
      subject: "admin-1",
      portalHomeUrl: "https://pandalabs.cn/",
    })

    renderShell()

    // 品牌:mark + 应用名双行(模板 AppLayout 结构,应用身份)。
    expect(screen.getByRole("img", { name: "PandaAuth by PandaLabs" })).toHaveAttribute("src", "/admin/pandaauth-logo-horizontal.png")
    // 导航来自 lib/nav.ts 单源(t() 过语言层)。
    expect(screen.getByText("用户管理")).toBeInTheDocument()
    expect(screen.getByText("审计查询")).toBeInTheDocument()
    // 身份区:NavUser 消费会话;下拉打开后见账号自助外链(IDP /me 契约)。
    expect(await screen.findByText("管理员甲")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /管理员甲/ }))
    expect(await screen.findByRole("menu")).toBeInTheDocument()
    expect(screen.getByText("账号设置")).toHaveAttribute("href", "/me")
    // 顶栏常驻件:返回门户 + 修改密码(IDP 页,整页跳转)。
    expect(screen.getByText("返回熊猫门户")).toBeInTheDocument()
    expect(screen.getByText("修改密码")).toHaveAttribute("href", "/account/change-password?returnUrl=/admin")
  })

  it("switches UI language via the header toggle (persisted like the legacy i18next store key)", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "me").mockResolvedValue({
      displayName: "甲",
      roles: ["admin"],
      accountEntryUrl: "/me",
      subject: "admin-1",
      portalHomeUrl: null,
    })

    renderShell()

    // 顶栏语言切换:EN ↔ 中文,持久化键保持 panda.admin.lang(存量用户语言选择不丢)。
    await user.click(screen.getByRole("button", { name: "切换语言" }))
    expect(localStorage.getItem("panda.admin.lang")).toBe("en")
    expect(screen.getByText("Navigation")).toBeInTheDocument()
    expect(screen.queryByText("导航")).not.toBeInTheDocument()
  })
})
