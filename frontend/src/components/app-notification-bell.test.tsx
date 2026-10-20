import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { Providers } from "@/test/utils"
import AppNotificationBell from "./app-notification-bell"
const state = vi.hoisted(() => ({ items: [], unread: 0, loading: false, error: null as string | null, markError: null as string | null, marking: false, markAllRead: vi.fn(), markRead: vi.fn(), retry: vi.fn() }))
vi.mock("@/hooks/use-notifications", () => ({ useNotifications: () => state }))
afterEach(() => { cleanup(); state.loading = false; state.error = null; state.markError = null; vi.clearAllMocks() })
function open() { render(<Providers><AppNotificationBell /></Providers>); fireEvent.click(screen.getByRole("button", { name: /通知/ })) }
it("shows loading rather than an empty result", () => { state.loading = true; open(); expect(screen.getByRole("status")).toHaveTextContent("正在加载通知"); expect(screen.queryByText("暂无通知")).not.toBeInTheDocument() })
it("offers retry on load failure", () => { state.error = "load failed"; open(); expect(screen.getByRole("alert")).toHaveTextContent("load failed"); fireEvent.click(screen.getByRole("button", { name: "重试" })); expect(state.retry).toHaveBeenCalledOnce() })
it("labels the recent window and empty state", () => { open(); expect(screen.getByText("最近 50 条通知")).toBeInTheDocument(); expect(screen.getByText("暂无通知")).toBeInTheDocument() })
it("shows mark-read failures", () => { state.markError = "write failed"; open(); expect(screen.getByRole("alert")).toHaveTextContent("write failed") })
