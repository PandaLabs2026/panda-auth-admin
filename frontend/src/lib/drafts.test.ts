import { afterEach, describe, expect, it } from "vitest"
import { consumeDraft, saveDraftWithoutPassword, withoutPassword } from "./drafts"

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
