import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useOneTimeValue } from "./use-one-time-value"

type Operation = ReturnType<ReturnType<typeof useOneTimeValue>["begin"]>

describe("one-time values", () => {
  it("survives refresh of the same owner but cannot reappear after switching away", () => {
    const { result, rerender } = renderHook(({ owner }) => useOneTimeValue(owner), { initialProps: { owner: "a" } })
    act(() => { result.current.begin().reveal("fixture-secret") })
    rerender({ owner: "a" })
    expect(result.current.value).toBe("fixture-secret")
    rerender({ owner: "b" })
    expect(result.current.value).toBeNull()
    rerender({ owner: "a" })
    expect(result.current.value).toBeNull()
  })

  it("drops a response from an earlier selection period even after returning to that owner", () => {
    const { result, rerender } = renderHook(({ owner }) => useOneTimeValue(owner), { initialProps: { owner: "a" } })
    let pending: Operation | undefined
    act(() => { pending = result.current.begin() })
    rerender({ owner: "b" }); rerender({ owner: "a" })
    act(() => { pending!.reveal("stale-secret") })
    expect(result.current.value).toBeNull()
  })

  it("only reveals the latest credential request and clearing invalidates in-flight results", () => {
    const { result } = renderHook(() => useOneTimeValue("a"))
    let older: Operation | undefined, newer: Operation | undefined
    act(() => { older = result.current.begin(); newer = result.current.begin() })
    act(() => { newer!.reveal("new"); older!.reveal("old") })
    expect(result.current.value).toBe("new")
    act(() => { result.current.clear(); newer!.reveal("after-close") })
    expect(result.current.value).toBeNull()
  })

  it("can reveal a newly created owner only once that owner is selected", () => {
    const { result, rerender } = renderHook(({ owner }) => useOneTimeValue(owner), { initialProps: { owner: "a" } })
    act(() => { result.current.begin().reveal("created-secret", "created") })
    expect(result.current.value).toBeNull()
    rerender({ owner: "created" })
    expect(result.current.value).toBe("created-secret")
  })

  it("keeps owner watches independent of credential requests and stores no secret in browser storage", () => {
    const { result, rerender, unmount } = renderHook(({ owner }) => useOneTimeValue(owner), { initialProps: { owner: "a" } })
    const ownerIsCurrent = result.current.watchOwner()
    const valueIsCurrent = result.current.watchValue()
    let pending: Operation | undefined
    act(() => { pending = result.current.begin(); pending.reveal("private-once-fixture") })
    expect(ownerIsCurrent()).toBe(true)
    expect(valueIsCurrent()).toBe(false)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("private-once-fixture")
    rerender({ owner: "b" })
    expect(ownerIsCurrent()).toBe(false)
    unmount()
    expect(pending!.current()).toBe(false)
  })
})
