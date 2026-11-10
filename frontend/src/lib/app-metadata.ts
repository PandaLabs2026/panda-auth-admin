/** Product names come from the owner-maintained organization registry, never a route or session. */
export function formatAppTitle(productName: string): string {
  const name = productName.trim();
  if (!name || /[|\r\n]/u.test(name)) throw new Error('Configure a registered product name without a title suffix');
  return `${name} | Panda Labs`;
}

/** Browser startup only; the same formatter is used for the initial HTML at build time. */
export function applyAppTitle(productName: string): void {
  document.title = formatAppTitle(productName);
}
