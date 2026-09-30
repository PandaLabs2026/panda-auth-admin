# panda-auth-admin

**PandaAuth by PandaLabs** · [简体中文](README.md)

> The PandaAuth suite is currently in **Community Preview 0.2.0-preview.1** — deployed in production and open to early community users. The stable Community Release 1.0.0 has not shipped yet. Access is by invitation or request.

## Responsibility and boundaries

PandaAuth administration uses a .NET 10 BFF and React 19 frontend. Production path: `/admin`; backend binding: 127.0.0.1:9006. Management data is intended to flow through Server Admin APIs rather than direct database access.

## Current implementation and limitations

The [backend](src/PandaAuth.Admin/Program.cs) runs as a first-party OIDC client: `GET /admin/login` is the authentication challenge endpoint (authorization code + PKCE), with cookie sessions and antiforgery tokens. The [login page](frontend/src/pages/login.tsx) navigates to the challenge endpoint; no credentials are entered on this site.

Health path `/admin/healthz` and antiforgery endpoint `/admin/api/antiforgery` exist. User, client, role and audit management pages are implemented. Cookie/antiforgery configuration is not proof of completed security acceptance.

## Prerequisites, build and run

Use the .NET SDK selected by [global.json](global.json) (currently 10.0.112 with latestFeature roll-forward). This repository has no cross-repository source dependency and can be built without the private coordination repository. Commands below run from this repository root.

Use Node 24 and npm for the frontend, matching the Docker build environment. There is no cross-repository ProjectReference. Frontend output is written to the BFF's `wwwroot/admin`.

```bash
dotnet build PandaAuth.Admin.slnx
cd frontend
npm ci
npm run build
cd ..
dotnet run --project src/PandaAuth.Admin
```

After building, http://localhost:9006/admin/login only shows the login scaffold. For frontend hot reload, use another terminal starting at the repository root:

```bash
cd frontend
npm run dev
```

The frontend uses port 5171 and proxies APIs to 9006. Full backend login is not implemented; rendering a page is not integration acceptance.

## Roadmap and governance

Product roadmap, release gates and community/commercial boundaries remain maintainer-governed until a formal public release. This README documents only the independently reproducible admin build boundary.

- [Security](SECURITY.md): selected private reporting channel, enablement unverified; no public vulnerability details.
- [Contributing](CONTRIBUTING.md): repository-specific checks and the shared contribution policy.
- [MIT License](LICENSE) for project-owned code/documentation, subject to [license scope](LICENSING.md); third-party terms remain applicable and brand images are excluded.
