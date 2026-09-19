using System.Net;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using OpenIddict.Client;
using OpenIddict.Client.AspNetCore;
using PandaAuth.Shared;
using PandaAuth.WebAdmin;
using static OpenIddict.Abstractions.OpenIddictConstants;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAntiforgery(options => options.HeaderName = "X-XSRF-Token");
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        // 挑战默认走 OpenIddict 客户端方案：未登录 → 302 到 IDP 授权端点（授权码 + PKCE）。
        options.DefaultChallengeScheme = OpenIddictClientAspNetCoreDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "PandaAuth.WebAdmin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.LoginPath = "/admin/login";
        // 时效：管理面比 me（8 小时）更紧——2 小时闲置过期 + 活动滑动续期。
        // Cookie 票据内含 refresh_token（IDP 侧 14 天），长期凭据不应以管理员身份长期驻留浏览器；
        // 这是安全与免重复登录之间的取舍，与 me 的差异是刻意的（管理面 vs 终端用户面）。
        options.ExpireTimeSpan = TimeSpan.FromHours(2);
        options.SlidingExpiration = true;
    });

// 会话 Cookie 与防伪令牌由 DataProtection 保护。Auth:DataProtectionKeyPath 非空时持久化密钥环
// （生产由 compose 注入卷路径），容器重建后既有登录态不失效；默认空串 = 临时密钥，仅限开发环境。
// 应用名固定为 PandaAuth.WebAdmin：不同服务不共用密钥环，各服务的卷本就独立。
var dataProtectionKeyPath = builder.Configuration["Auth:DataProtectionKeyPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionKeyPath))
{
    // 路径必须已存在：生产由 compose 命名卷挂载保证；不存在即说明「配置路径与卷挂载点不一致」，
    // 此时绝不能静默创建到容器临时层（密钥随容器重建即丢），必须失败关闭。
    // PersistKeysToFileSystem 自身会静默创建缺失目录且不告警，故守卫必须显式。
    if (!Directory.Exists(dataProtectionKeyPath))
    {
        throw new InvalidOperationException(
            $"DataProtection 密钥目录不存在：{dataProtectionKeyPath}（生产应由 compose 命名卷挂载到该路径）");
    }

    builder.Services
        .AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeyPath))
        .SetApplicationName("PandaAuth.WebAdmin");
}

// IDP 侧取值集中取出：OpenIddict 客户端注册与登出撤销客户端共用同一组配置，避免两份事实源。
var issuer = new Uri(builder.Configuration["Auth:Issuer"] ?? "http://localhost:9004/");
var clientId = builder.Configuration["Auth:ClientId"] ?? "admin-web";
// 机密客户端密钥失败关闭：缺失/为空即拒绝启动，不回退明文默认值（与 server 侧 Seeder、me 侧行为对齐）。
var clientSecret = builder.Configuration["Auth:ClientSecret"];
if (string.IsNullOrWhiteSpace(clientSecret))
{
    throw new InvalidOperationException("缺少 Auth:ClientSecret 配置（admin-web 为机密客户端，密钥须由部署环境注入）。");
}

// 登出撤销客户端。超时取值的读取与校验都在 AddTokenRevocation 内、启动期完成——
// 不能留给 AddHttpClient 的 configure 委托（它只在解析该类型时才执行）。
builder.Services.AddTokenRevocation(builder.Configuration, new TokenRevocationOptions(issuer, clientId, clientSecret));

// Admin 数据 API 代理（webadmin 0.3）：直连 IDP 内部地址（同 host network，不经公网/Caddy）。
// 基址可配（Auth:IdpInternalBaseAddress），默认回环 9004——公网形态下该前缀在 Caddy 路由表外，
// IDP 侧另有 Bearer + admin 角色门禁，双保险。
var idpInternalBase = builder.Configuration["Auth:IdpInternalBaseAddress"] ?? "http://127.0.0.1:9004/";
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient<AdminApiProxy>(client =>
{
    client.BaseAddress = new Uri(idpInternalBase);
    client.Timeout = TimeSpan.FromSeconds(30);
});

// 管理后台 BFF：OIDC 客户端（授权码 + PKCE + 刷新令牌），由 panda-auth-server 的 Seeder 预置 admin-web。
builder.Services.AddOpenIddict()
    .AddClient(options =>
    {
        options.AllowAuthorizationCodeFlow();
        options.AllowRefreshTokenFlow();

        // webadmin 是 BFF：令牌保存在 DataProtection 保护的会话 Cookie 中（回调处显式 StoreTokens），
        // 不使用 OpenIddict 的服务端令牌存储，故无需注册 OpenIddict core 服务（与 me 同款理由）。
        options.DisableTokenStorage();

        options.AddEphemeralEncryptionKey();
        options.AddEphemeralSigningKey();
        options.UseSystemNetHttp();
        options.UseAspNetCore()
            .EnableRedirectionEndpointPassthrough()
            .EnablePostLogoutRedirectionEndpointPassthrough()
            .EnableErrorPassthrough();

        // 第一方客户端（admin-web，机密 + PKCE）。roles scope 是登录门禁的**硬依赖**
        //（回调按 admin 角色判定，缺失即 403 失败关闭）；offline_access 供登出时撤销 refresh_token。
        options.AddRegistration(new OpenIddictClientRegistration
        {
            ProviderName = "pandaauth",
            Issuer = issuer,
            ClientId = clientId,
            ClientSecret = clientSecret,
            Scopes =
            {
                Scopes.OpenId,
                Scopes.Profile,
                Scopes.Email,
                Scopes.Roles,
                Scopes.OfflineAccess,
            },
            // 实际回调路由为 /admin/callback/login/{provider}（Caddy 以 /admin 路径反代）；生产值由 compose 注入。
            RedirectUri = new Uri(builder.Configuration["Auth:RedirectUri"] ?? "http://localhost:9006/admin/callback/login/pandaauth"),
            PostLogoutRedirectUri = new Uri(builder.Configuration["Auth:PostLogoutRedirectUri"] ?? "http://localhost:9006/admin/"),
        });
    });

// 登录挑战端点限流（按 IP 固定窗口）：只卡 /admin/login 本身，防的是挑战刷量与授权端点滥用；
// 真正的凭据暴力尝试发生在 IDP 的 /account/login，由其 IP/账号双维限流与 Identity 锁定覆盖
//（server 侧 LoginRateLimiter + login_logs 审计，admin 账号同样计入）——分工写死在此，避免重复建设。
// .NET 内置 RateLimiter（System.Threading.RateLimiting），无新增依赖。
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("admin-login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

// 默认拒绝：未显式声明授权的端点一律要求已认证用户。
// AddAuthorization() 不带 FallbackPolicy 时的默认是「放行」——每新增一个 API 都要记得补
// RequireAuthorization，漏一处的后果是**管理数据默认公开**：漏掉的默认值是失败开放，
// 且不会有人发现。FallbackPolicy 把默认值翻转成失败关闭。
// 代价是匿名端点必须显式列出（下面各处 + SPA 静态文件与回退），漏列的后果是「自己打不开」，
// 开发期立刻暴露——两类错误的可见性天差地别，这是选它的理由。
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});
builder.Services.AddHealthChecks();

var app = builder.Build();

// Caddy 以 HTTP 反代到 127.0.0.1:9006 并终结 TLS，需还原真实 Scheme 与客户端 IP。
// 仅信任回环代理（Caddy 与容器同 host network，真实代理永远是回环地址）：伪造发生在 XFF 头链而非连接层，
// 端口绑定 127.0.0.1 不能消除伪造风险，全量网段信任属失败开放配置。
// ForwardLimit=1：只消费 Caddy 追加的最右一跳真实客户端 IP，攻击者伪造的最左值无法污染限流与审计。
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1,
    KnownProxies = { IPAddress.Loopback, IPAddress.IPv6Loopback },
});

app.UseMiddleware<SecurityHeadersMiddleware>();

// SPA 静态资源（frontend/ 构建产物落在 wwwroot/admin）。
// 必须排在认证/授权之前：静态文件中间件命中文件即短路，其后的授权中间件根本不会执行，
// 于是 js/css/图标天然豁免 FallbackPolicy。反过来若授权先跑，请求没有匹配到端点，
// FallbackPolicy 会把它们一并拦下——登录页的 HTML 能拿到、脚本却 401，
// 表现是「登录页白屏」，且因为 HTML 本身是 200，排查时极易误判成前端故障。
// 因此这两个中间件的位置在这里显式写死，而不是交给框架的自动插入顺序。
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
// 限流中间件：基于端点元数据（RequireRateLimiting）生效，须在认证之后（限流分区取真实 IP 依赖
// ForwardedHeaders 已处理）、端点执行之前。
app.UseRateLimiter();

var antiforgery = app.Services.GetRequiredService<IAntiforgery>();

// BFF API 端点。以下匿名豁免各条都有「为什么可以匿名」的理由；其余端点默认走 FallbackPolicy。

// 登录挑战：全页导航入口（SPA 不经 XHR 调它；302 到 IDP 授权端点）。
// 匿名是必需而非让步：登录入口本身不能要求已认证。returnUrl 经白名单校验防开放重定向。
app.MapGet("/admin/login", (string? returnUrl) =>
    Results.Challenge(new AuthenticationProperties
    {
        RedirectUri = LoginReturnUrl.Sanitize(returnUrl),
    })).RequireRateLimiting("admin-login").AllowAnonymous();

// OIDC 回调：OpenIddict 客户端完成授权码 + PKCE 校验后落到这里建立会话。
// 匿名是必需的：回调发生在会话建立之前。
app.MapGet("/admin/callback/login/{provider}", async (HttpContext context) =>
{
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("PandaAuth.WebAdmin.Callback");

    var result = await context.AuthenticateAsync(OpenIddictClientAspNetCoreDefaults.AuthenticationScheme);
    if (result is not { Succeeded: true } || result.Principal is null)
    {
        // 认证失败（state 不符、码无效等）不渲染错误详情，回到登录入口重走挑战。
        return Results.Redirect("/admin/login");
    }

    var (identity, isAdmin) = AdminSessionIdentity.Build(result.Principal);

    // AdminRole 门禁：判定在服务端回调处强制，不依赖前端隐藏。失败关闭——roles 缺失（例如
    // userinfo 声明未到达）等同无角色，同样 403。审计记 warning（含 sub 与 IP，供追查），
    // 不记任何令牌或凭据。
    if (!isAdmin)
    {
        logger.LogWarning(
            "管理后台登录被拒：sub={Subject} 不具备 admin 角色（IP={IpAddress}）。",
            identity.FindFirst(Claims.Subject)?.Value,
            context.Connection.RemoteIpAddress);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Results.Content(
            "<!doctype html><html lang=\"zh\"><meta charset=\"utf-8\"><title>403</title>" +
            "<body style=\"font-family:system-ui;padding:3rem\">该账号没有管理后台权限。</body></html>",
            "text/html; charset=utf-8");
    }

    // 令牌写入会话票据（DataProtection 保护）：登出时据此向 IDP 撤销 refresh/access token。
    // ⚠️ OpenIddict 客户端把 AT 存在 backchannel_access_token 键下——GetTokenValue("access_token")
    // 恒为 null（2026-09-19 生产诊断实证：Properties 键为 .Token.backchannel_access_token）。
    // refresh_token 键名恰好一致可直接取。会话票据内部仍用 SessionTokens 常量存储（自持命名，
    // 下游 proxy / 登出撤销的读取不变）。
    var resultProperties = result.Properties!;
    logger.LogInformation(
        "回调诊断：AT={HasAt} RT={HasRt}",
        resultProperties.GetTokenValue("backchannel_access_token") is not null,
        resultProperties.GetTokenValue(SessionTokens.RefreshTokenName) is not null);
    var properties = new AuthenticationProperties();
    var tokens = new List<AuthenticationToken>();
    if (resultProperties.GetTokenValue("backchannel_access_token") is { } accessToken)
    {
        tokens.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = accessToken });
    }

    if (resultProperties.GetTokenValue(SessionTokens.RefreshTokenName) is { } refreshToken)
    {
        tokens.Add(new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = refreshToken });
    }

    if (tokens.Count > 0)
    {
        properties.StoreTokens(tokens);
    }

    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);
    logger.LogInformation(
        "管理员会话建立：sub={Subject}（IP={IpAddress}）。",
        identity.FindFirst(Claims.Subject)?.Value,
        context.Connection.RemoteIpAddress);
    // 落点优先取 challenge 时经 state 令牌往返保留的 RedirectUri（api 层 401 跳转带 returnUrl），
    // 不能硬编码 Fallback——否则任何静默重登都把用户拽回概览（2026-09-19「跳回」的第二环）。
    // Sanitize 再兜一层：state 内容理论上是本服务签发的，但防御纵深零成本。
    var target = result.Properties?.RedirectUri;
    return Results.Redirect(string.IsNullOrWhiteSpace(target) ? LoginReturnUrl.Fallback : LoginReturnUrl.Sanitize(target));
}).AllowAnonymous();

// 会话查询（SPA 用）：未登录 401（前端引导全页跳 /admin/login），已登录回显身份与角色。
// 匿名豁免 + 手动 401 是刻意的：走 FallbackPolicy 会得到 302（Cookie LoginPath），
// 前端拿到的是登录页 HTML 而不是 401，无法据此判定「未登录」。
app.MapGet("/admin/api/session", (HttpContext context) =>
{
    if (context.User.Identity?.IsAuthenticated != true)
    {
        return Results.Unauthorized();
    }

    return Results.Ok(new
    {
        subject = context.User.FindFirst(Claims.Subject)?.Value ?? string.Empty,
        name = context.User.FindFirst(Claims.Name)?.Value,
        email = context.User.FindFirst(Claims.Email)?.Value,
        nickname = context.User.FindFirst(PandaAuthClaims.Nickname)?.Value,
        roles = context.User.FindAll(Claims.Role).Select(claim => claim.Value).ToArray(),
    });
}).AllowAnonymous();

// 登出：防伪校验 → 撤销 IDP 令牌（尽力而为）→ 清本地会话 → RP 端到端登出（end-session）。
// 不匿名豁免：登出只对已登录会话有意义；匿名 POST 由 FallbackPolicy 拦下（302，前端仅在有会话时调用）。
app.MapPost("/admin/api/logout", async (HttpContext context, TokenRevocationClient revocationClient) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(context);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    // 先取令牌再登出：Cookie 清除后票据内的令牌不可恢复。
    var (accessToken, refreshToken) = SessionTokens.Read(
        await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme));

    await revocationClient.RevokeAsync(accessToken, refreshToken, context.RequestAborted);
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

    // RP 发起的前端登出：重定向到 IDP 的 end-session 端点（单点登出），再回 PostLogoutRedirectUri。
    return Results.SignOut(
        new AuthenticationProperties { RedirectUri = "/admin/" },
        [OpenIddictClientAspNetCoreDefaults.AuthenticationScheme]);
});

// ---- Admin 数据 API 代理端点（webadmin 0.3）----
// 全部落在 FallbackPolicy 下（需已认证）；变更类（POST/PUT）先验防伪再转发 JSON 体；
// GET 透传查询串。上游路径取自 share 契约常量（PandaAuthAdminApi），两端不写 URL 字面量。
async Task<string?> ReadJsonBodyAsync(HttpContext ctx)
{
    if (ctx.Request.ContentLength is null or 0)
    {
        return null;
    }

    using var reader = new StreamReader(ctx.Request.Body);
    return await reader.ReadToEndAsync(ctx.RequestAborted);
}

app.MapGet("/admin/api/users", (HttpContext ctx, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.Users + ctx.Request.QueryString.Value, HttpMethod.Get));

app.MapGet("/admin/api/users/{id}", (string id, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.User(id), HttpMethod.Get));

app.MapPost("/admin/api/users/{id}/status", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserStatus(id), HttpMethod.Post, await ReadJsonBodyAsync(ctx));
});

app.MapPost("/admin/api/users/{id}/reset-password", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserResetPassword(id), HttpMethod.Post, await ReadJsonBodyAsync(ctx));
});

app.MapPost("/admin/api/users", async (HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.Users, HttpMethod.Post, await ReadJsonBodyAsync(ctx));
});

app.MapPut("/admin/api/users/{id}/roles", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserRoles(id), HttpMethod.Put, await ReadJsonBodyAsync(ctx));
});

app.MapPost("/admin/api/users/{id}/unlock", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserUnlock(id), HttpMethod.Post);
});

app.MapPut("/admin/api/users/{id}/profile", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserProfile(id), HttpMethod.Put, await ReadJsonBodyAsync(ctx));
});

app.MapPost("/admin/api/users/{id}/reset-2fa", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserResetTwoFactor(id), HttpMethod.Post);
});

app.MapPost("/admin/api/users/{id}/deactivate", async (string id, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.UserDeactivate(id), HttpMethod.Post, await ReadJsonBodyAsync(ctx));
});

app.MapGet("/admin/api/clients", (HttpContext ctx, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.Clients + ctx.Request.QueryString.Value, HttpMethod.Get));

app.MapGet("/admin/api/clients/options", (AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.ClientOptions, HttpMethod.Get));

app.MapGet("/admin/api/clients/{clientId}", (string clientId, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.Client(clientId), HttpMethod.Get));

app.MapPut("/admin/api/clients/{clientId}/redirect-uris", async (string clientId, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.ClientRedirectUris(clientId), HttpMethod.Put, await ReadJsonBodyAsync(ctx));
});

app.MapPut("/admin/api/clients/{clientId}/permissions", async (string clientId, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.ClientPermissions(clientId), HttpMethod.Put, await ReadJsonBodyAsync(ctx));
});

app.MapPost("/admin/api/clients/{clientId}/rotate-secret", async (string clientId, HttpContext ctx, AdminApiProxy proxy) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await proxy.ForwardAsync(PandaAuthAdminApi.ClientRotateSecret(clientId), HttpMethod.Post);
});

app.MapGet("/admin/api/audit/logins", (HttpContext ctx, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.AuditLogins + ctx.Request.QueryString.Value, HttpMethod.Get));

app.MapGet("/admin/api/audit/admin", (HttpContext ctx, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.AuditAdmin + ctx.Request.QueryString.Value, HttpMethod.Get));

// 防伪令牌发放：登录之前把令牌发给 SPA（要求认证会形成鸡生蛋）。
app.MapGet("/admin/api/antiforgery", (HttpContext context) =>
{
    var tokens = antiforgery.GetAndStoreTokens(context);
    return Results.Ok(new { token = tokens.RequestToken });
}).AllowAnonymous();

// 探活匿名：容器 healthcheck 由 docker 发起，不带任何凭据；它只回 healthy/unhealthy，不泄露管理数据。
app.MapHealthChecks("/admin/healthz").AllowAnonymous();

// BFF 保留命名空间不参与 SPA 回退——**这是默认拒绝能否成立的关键一条**。
// 少写它，未映射的 API 路径就会被下面的 SPA 回退接走并返回 200 + index.html：
// 于是探不到 401，也分不清「路径拼错」与「端点漏加授权」，FallbackPolicy 在 API 面上形同虚设。
// 前缀清单集中在 BffRoutes.ProtectedPrefixes：兜底是**按前缀专有**的，新增服务端命名空间
//（如 /admin/v2）时加进那个数组即可，不必记得来这里补一行。
// 显式 RequireAuthorization：即使将来有人去掉 FallbackPolicy，这些命名空间的默认归属也不变。
// 认证过的调用方拿到 404（路径确实不存在），匿名调用方先在授权阶段被拦下。
foreach (var prefix in BffRoutes.ProtectedPrefixes)
{
    app.MapFallback($"{prefix}/{{**path}}", () => Results.NotFound()).RequireAuthorization();
}

// SPA 回退：/admin 下非文件路径一律返回 index.html（前端路由接管）。
// 匿名是必需的：登录页 /admin/login 的外壳就由这里返回，它若是 401，登录入口直接不存在。
// 注意放行的是**外壳**，不是数据——页面能加载不代表能拿到管理 API 的任何响应。
// 路由优先级：/admin/api/* 由上面那条更具体的回退接管（字面量段 api 胜过 catch-all），
// 与本行的注册先后无关。
app.MapFallbackToFile("/admin/{*path:nonfile}", "admin/index.html").AllowAnonymous();

app.Run();

// 供集成测试 WebApplicationFactory<Program> 引用（最小 API 顶层语句的类不可见问题）。
// 必须位于全部顶层语句之后（含 app.Run()）。
public partial class Program;
