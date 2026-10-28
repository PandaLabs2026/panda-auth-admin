import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { bindDraftOwner, saveDraft, consumeDraft, saveDraftWithoutPassword, withoutPassword } from "./drafts"

beforeEach(() => bindDraftOwner("fixture-owner"))
afterEach(() => sessionStorage.clear())

describe("saveDraftWithoutPassword", () => {
  it("persists the create-user draft with an empty password", () => {
    const draft = {
      userName: "new-user",
      email: "new@example.test",
      password: "one-time-secret",
      grantAdminRole: false,
    }

    saveDraftWithoutPassword("users.create", draft)

    expect(consumeDraft<typeof draft>("users.create")).toEqual({ ...draft, password: "" })
    expect(draft.password).toBe("one-time-secret")
  })

  it("clears a password from legacy session drafts when restored", () => {
    expect(withoutPassword({ userName: "legacy", password: "old-secret" })).toEqual({
      userName: "legacy",
      password: "",
    })
  })
})

it("does not restore a draft saved by another operator", () => {
  saveDraft("users.claim", { value: "operator A" })
  bindDraftOwner("other-operator")
  expect(consumeDraft("users.claim")).toBeNull()
})
it("keeps an approved draft across authentication for the same operator", () => {
  saveDraft("users.claim", { value: "same operator" })
  bindDraftOwner("fixture-owner")
  expect(consumeDraft("users.claim")).toEqual({ value: "same operator" })
})
