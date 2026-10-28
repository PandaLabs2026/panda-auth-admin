export interface AuthNavigationOptions {
  key: string;
  loginPath: string;
  home: string;
  replace?: (url: string) => void;
}
/** Non-secret per-tab UX markers; never an authorization source. */
export function createAuthNavigation(options: AuthNavigationOptions) {
  const attempt = `${options.key}.login-attempt`, signedOut = `${options.key}.signed-out`, pendingLogout = `${options.key}.logout-pending`;
  const href = (target: string) => options.loginPath + '?returnUrl=' + encodeURIComponent(target);
  const wasSignedOut = () => { try { return sessionStorage.getItem(signedOut) === '1'; } catch { return false; } };
  const logoutPending=()=>{try{return sessionStorage.getItem(pendingLogout)==='1';}catch{return false;}};
  return {
    logoutPending, markLogoutPending(){try{sessionStorage.setItem(pendingLogout,'1');}catch{/* explicit status still works */}},
    href, home: options.home, wasSignedOut,
    confirmSession() { try { sessionStorage.removeItem(attempt); sessionStorage.removeItem(signedOut); sessionStorage.removeItem(pendingLogout); } catch { /* no authorization decisions */ } },
    markSignedOut() { try { sessionStorage.setItem(signedOut, '1'); sessionStorage.removeItem(attempt); sessionStorage.removeItem(pendingLogout); } catch { /* terminal page remains usable */ } },
    start(target: string, manual = false) {
      try {
        const pending = Number(sessionStorage.getItem(attempt));
        const age = Date.now() - pending;
        if (!manual && (wasSignedOut() || logoutPending() || pending > 0 && age < 10 * 60 * 1000)) return false;
        sessionStorage.removeItem(signedOut); sessionStorage.removeItem(pendingLogout);
        sessionStorage.setItem(attempt, String(Date.now()));
      } catch { if (!manual) return false; }
      (options.replace ?? (url => window.location.replace(url)))(href(target));
      return true;
    },
  };
}
export type AuthNavigation = ReturnType<typeof createAuthNavigation>;
