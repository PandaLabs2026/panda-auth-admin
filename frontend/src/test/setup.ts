import "@testing-library/jest-dom/vitest"

import i18n from "@/i18n"

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string): MediaQueryList => ({
      matches: false,
      media,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// 测试钉死 zh-CN：jsdom 的 navigator.language 是 en-US，不钉会走 en 资源、
// 使所有中文文案断言失去确定性（#31 步骤一的自然键方案下 en 为增量资源）。
void i18n.changeLanguage("zh-CN")
