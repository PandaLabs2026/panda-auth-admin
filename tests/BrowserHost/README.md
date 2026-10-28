# Isolated browser protocol check

Runs the actual Admin BFF and production SPA against a test-only signed OIDC provider.
It verifies authorization-code login with PKCE, browser reload, native CSRF logout,
the logout callback and a subsequent anonymous session (401). No production identity,
database, credentials or deployment is involved. This is not production acceptance.

Build the frontend and BrowserHost, then start the host from the repository root:

```sh
export TMPDIR="$HOME/dev/tmp"
npm --prefix frontend run build
dotnet build tests/BrowserHost/PandaAuth.Admin.BrowserHost.csproj
dotnet run --no-build --project tests/BrowserHost/PandaAuth.Admin.BrowserHost.csproj -- "$PWD" "$TMPDIR/admin-browser-host.json"
```

In another terminal use an environment with Playwright Python and its matching
Chromium installation (validated with Playwright 1.49):

```sh
python tests/BrowserHost/protocol.py "$TMPDIR/admin-browser-host.json" "$TMPDIR/admin-browser-results"
```

Stop the host with Ctrl-C after verification. Both HTTPS listeners use random
loopback ports. Certificates and signing keys are generated in memory. Test-only
backchannel trust is restricted to loopback and this certificate; product validation
is unchanged. Metadata contains only listener addresses; results and screenshots stay
outside the repository. The fixture issues synthetic tokens only within the protocol,
and its evidence endpoint exposes counters, not token/state values. The fixture is
not a substitute for Server authorization, tenant, MFA, or production IDP testing.
