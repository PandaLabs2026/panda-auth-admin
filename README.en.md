# panda-auth-webadmin

**PandaAuth by PandaLabs** · [简体中文](README.md)

> In development; no formally supported release yet. Access is by invitation or request. Implementation does not imply a verified release.

## Responsibility and boundaries

PandaAuth administration uses a .NET 10 BFF and React 19 frontend. Production path: `/admin`; backend binding: 127.0.0.1:9006. Management data is intended to flow through Server Admin APIs rather than direct database access.

## Current implementation and limitations

The [backend](src/PandaAuth.WebAdmin/Program.cs) has Cookie configuration, antiforgery tokens and static hosting. The [login page](frontend/src/pages/login.tsx) is a placeholder. `POST /admin/api/auth/login` always returns 501; real administrator login and dynamic client management are not available.

Health path `/admin/healthz` and antiforgery endpoint `/admin/api/antiforgery` exist. User, client and audit management are Phase 1 targets. Cookie/antiforgery configuration is not proof of completed security acceptance.

## Prerequisites, build and run

Use the .NET SDK selected by [global.json](global.json) (currently 10.0.112 with latestFeature roll-forward). Clone repositories as siblings using the [workspace layout](https://github.com/PandaLabs2026/panda-auth/blob/main/WORKSPACE.md); cross-repository links require access. Commands below run from this repository root. They were statically checked, not executed, in this documentation change.

Use Node 24 and npm for the frontend, matching the Docker build environment. There is no cross-repository ProjectReference. Frontend output is written to the BFF's `wwwroot/admin`.

```bash
dotnet build PandaAuth.WebAdmin.slnx
cd frontend
npm ci
npm run build
cd ..
dotnet run --project src/PandaAuth.WebAdmin
```

After building, http://localhost:9006/admin/login only shows the login scaffold. For frontend hot reload, use another terminal starting at the repository root:

```bash
cd frontend
npm run dev
```

The frontend uses port 5171 and proxies APIs to 9006. Full backend login is not implemented; rendering a page is not integration acceptance.

## Roadmap and governance

Implementation targets are tracked in the [capability matrix](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/capabilities.md) and [release gates](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/release-readiness.md). Real product needs drive the roadmap; community requests are evaluated without delivery commitments. [Community/commercial boundaries](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/strategy.md) describe scope, not delivered commercial products.

- [Security](SECURITY.md): selected private reporting channel, enablement unverified; no public vulnerability details.
- [Contributing](CONTRIBUTING.md): repository-specific checks and the shared contribution policy.
- [MIT License](LICENSE) for project-owned code/documentation, subject to [license scope](LICENSING.md); third-party terms remain applicable and brand images are excluded.
