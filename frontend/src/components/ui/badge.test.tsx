import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "./badge"

describe("Badge status variants", () => {
  it("renders API success and warning states with semantic classes", () => {
    render(
      <div>
        <Badge variant="success">Active</Badge>
        <Badge variant="warning">Pending</Badge>
      </div>,
    )

    expect(screen.getByText("Active")).toHaveClass("bg-success/10", "text-success")
    expect(screen.getByText("Pending")).toHaveClass("bg-warning/10", "text-warning")
  })
})
