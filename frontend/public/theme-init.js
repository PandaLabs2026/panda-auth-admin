// Synchronous bootstrap preserves the system theme before the SPA renders.
if (matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark")
}
