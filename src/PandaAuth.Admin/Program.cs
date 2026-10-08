using System.Net;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using OpenIddict.Client;
using OpenIddict.Client.AspNetCore;
using PandaAuth.Shared;
using PandaAuth.Admin;
using PandaAuth.Admin.Infrastructure.Security;
using HeaderNames = Microsoft.Net.Http.Headers.HeaderNames;
using static OpenIddict.Abstractions.OpenIddictConstants;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    TenantForwardedHeaders.Configure(options, builder.Configuration);
});

// 防伪 Cookie 恒 Secure（生产），与下方会话 Cookie 的 Always 约束一致：防伪令牌不落明文。
// 但 Antiforgery 对 Always 是服务端 fail-closed——非 SSL 请求直接抛 InvalidOperationException
//（DefaultAntiforgery.CheckSSLConfig），/admin/api/antiforgery 与 /admin/api/logout 都会 500，
// 后者的抛出不在 AntiforgeryValidationException 的 catch 内。浏览器对 localhost http 固然接受
// Secure cookie，中间件不等浏览器：本地开发是 launchSettings 直连 http://localhost:9006（无 TLS），
// 无条件 Always 会打断登出链路，故仅非 Development 环境收紧；生产容器为
// ASPNETCORE_ENVIRONMENT=Production，且经 Caddy TLS 反代（X-Forwarded-Proto 还原 https）。
// 行为由 AntiforgeryCookieSecurePolicyTests 钉住。
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-XSRF-Token";
    if (!builder.Environment.IsDevelopment())
    {
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    }
});
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        // 挑战默认走 OpenIddict 客户端方案：未登录 → 302 到 IDP 授权端点（授权码 + PKCE）。
        options.DefaultChallengeScheme = OpenIddictClientAspNetCoreDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "PandaAuth.Admin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.Path = "/admin";
        options.LoginPath = "/admin/login";
        // 时效：管理面比 me（8 小时）更紧——2 小时闲置过期 + 活动滑动续期。
        // Cookie 票据内含 refresh_token（IDP 侧 14 天），长期凭据不应以管理员身份长期驻留浏览器；
        // 这是安全与免重复登录之间的取舍，与 me 的差异是刻意的（管理面 vs 终端用户面）。
        options.ExpireTimeSpan = TimeSpan.FromHours(2);
        options.SlidingExpiration = true;
    });

// 会话 Cookie 与防伪令牌由 DataProtection 保护。Auth:DataProtectionKeyPath 非空时持久化密钥环
// （生产由 compose 注入卷路径），容器重建后既有登录态不失效；默认空串 = 临时密钥，仅限开发环境。
// 应用名固定为 PandaAuth.Admin：不同服务不共用密钥环，各服务的卷本就独立。
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
        .SetApplicationName("PandaAuth.Admin");
}

// 生产环境的 IDP 地址同样失败关闭：issuer/内网基址缺失**或仍是开发默认值**即拒绝启动。
// 只查缺失并不够——镜像里烤着开发取值的 appsettings.json，绕过 compose 环境变量直跑容器时
// 键永远「存在」，静默回退等于把公网流量指向开发地址、把配置事故变成运行期偶发故障。
// compose 部署恒注入真实值（deploy/docker-compose.yml 以 ${AUTH_ISSUER:?} 强制），
// 正常生产不受影响；开发环境保留回环默认，维持零配置启动。与下方 ClientSecret 同款哲学。
// 位置必须在首个 new Uri(...) 之前：空值先在这里被拦下，否则 Uri 构造先炸出 UriFormatException。
if (builder.Environment.IsProduction())
{
    if (string.IsNullOrWhiteSpace(builder.Configuration["Auth:Issuer"])
        || string.Equals(builder.Configuration["Auth:Issuer"]!.Trim(), "http://localhost:9004/", StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException("Auth:Issuer 缺失或仍是开发默认值（生产不得使用 http://localhost:9004/，须由部署环境注入真实 issuer）。");
    }

    if (string.IsNullOrWhiteSpace(builder.Configuration["Auth:IdpInternalBaseAddress"])
        || string.Equals(builder.Configuration["Auth:IdpInternalBaseAddress"]!.Trim(), "http://127.0.0.1:9004/", StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException("Auth:IdpInternalBaseAddress 缺失或仍是开发默认值（生产须由部署环境注入代理上游地址）。");
    }
}

// OpenIddict 客户端加密/签名密钥（保护在途登录 state）：DP 路径已配置则同目录 load-or-create
// client-keys.json——重启后旧 state 仍可完成回调，不再无声作废；开发（未配置 DP 路径）维持
// ephemeral（进程内临时材料），app.Logger 启动告警一次。
EncryptingCredentials? clientEncryptionCredentials = null;
SigningCredentials? clientSigningCredentials = null;
if (!string.IsNullOrWhiteSpace(dataProtectionKeyPath))
{
    (clientEncryptionCredentials, clientSigningCredentials) = ClientKeys.LoadOrCreate(dataProtectionKeyPath);
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

// Admin 数据 API 代理（admin 0.3）：直连 IDP 内部地址（同 host network，不经公网/Caddy）。
// 基址可配（Auth:IdpInternalBaseAddress），默认回环 9004——公网形态下该前缀在 Caddy 路由表外，
// IDP 侧另有 Bearer + admin 角色门禁，双保险。
var idpInternalBase = builder.Configuration["Auth:IdpInternalBaseAddress"] ?? "http://127.0.0.1:9004/";
builder.Services.AddHttpContextAccessor();
// 会话刷新接缝：生产实现包装 OpenIddict 客户端；单测经该接口桩刷新链路
//（OpenIddictClientService 的刷新方法非虚，具体类无法继承重写）。
builder.Services.AddSingleton<IAdminSessionRefresher, OpenIddictAdminSessionRefresher>();
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

        // admin 是 BFF：令牌保存在 DataProtection 保护的会话 Cookie 中（回调处显式 StoreTokens），
        // 不使用 OpenIddict 的服务端令牌存储，故无需注册 OpenIddict core 服务（与 me 同款理由）。
        options.DisableTokenStorage();

        // 客户端令牌保护密钥：持久化材料可用则注册之（重启不丢在途登录 state）；
        // 开发形态退回 ephemeral——临时材料随进程消亡，重启即作废全部在途授权。
        if (clientEncryptionCredentials is { } encryption && clientSigningCredentials is { } signing)
        {
            options.AddEncryptionCredentials(encryption);
            options.AddSigningCredentials(signing);
        }
        else
        {
            options.AddEphemeralEncryptionKey();
            options.AddEphemeralSigningKey();
        }

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
            // 实际回调路由为 /admin/callback/login/{provider}（Caddy 以 /admin 路径反代）。
            // 相对 URI 按请求的 host/scheme 解析，开发与生产同值可用；此处为硬编码，
            // 不存在按环境注入的通路（appsettings 的 Auth:RedirectUri 等键已随本改动删除）。
            RedirectUri = new Uri("admin/callback/login/pandaauth", UriKind.Relative),
            // post-logout 回调必须是专用路径：/admin/ 本身会被 OpenIddict 客户端拦截做登出回调提取，
// 无参数导航也被当作无 state 回调以 400 拒绝；且 IDP 种子登记的本来就是专用路径，
// 客户端硬编码 admin/ 与之失配会导致 end-session 被拒（2026-10-01 实测）。
PostLogoutRedirectUri = new Uri("admin/callback/logout/pandaauth", UriKind.Relative),
        });

        options.AddEventHandler<OpenIddictClientEvents.ProcessChallengeContext>(descriptor =>
            descriptor.UseInlineHandler(context =>
            {
                context.Issuer = TenantOidcRouting.ResolveIssuer(
                    context.Transaction.GetHttpRequest()
                        ?? throw new InvalidOperationException("OpenIddict challenge is missing the current HTTP request."), issuer);
                return default;
            }));
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

if (clientEncryptionCredentials is null)
{
    // 一次性启动告警：开发形态没配 Auth:DataProtectionKeyPath，客户端密钥是进程内临时材料。
    // 这在本地无伤（重启重登即可），但若出现在生产（配置回归）意味着每次发版都把在途登录打回。
    app.Logger.LogWarning("未配置 Auth:DataProtectionKeyPath：OpenIddict 客户端密钥为临时材料，重启将作废全部在途登录（应仅出现在开发环境）。");
}

// 全局异常兜底：管线内任何未处理异常统一折算为 ProblemDetails JSON——此前会落到裸 500
// 纯文本，前端 apiSend 的 ProblemDetails 解析路径对它无从下手。异常本体由
// ExceptionHandlerMiddleware 记日志，这里只回壳（title/detail 固定文案）：管理面响应
// 不得外泄内部堆栈与路径细节。放在管线最前是为了罩住其后全部中间件与端点（含代理转发）；
// SecurityHeaders 在进入后续管线前已写好响应头，错误响应同样带安全头。
app.UseExceptionHandler(errorApp => errorApp.Run(async httpContext =>
{
    await Results.Problem(
        statusCode: StatusCodes.Status500InternalServerError,
        title: "服务器内部错误",
        detail: "请求处理失败，请稍后重试。").ExecuteAsync(httpContext);
}));

// Legacy host-network runtime trusts loopback; tenant bridge runtime trusts only its exact Docker gateway.
app.UseForwardedHeaders(app.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value);

app.UseMiddleware<SecurityHeadersMiddleware>();

// SPA 静态资源（frontend/ 构建产物落在 wwwroot/admin）。
// 必须排在认证/授权之前：静态文件中间件命中文件即短路，其后的授权中间件根本不会执行，
// 于是 js/css/图标天然豁免 FallbackPolicy。反过来若授权先跑，请求没有匹配到端点，
// FallbackPolicy 会把它们一并拦下——登录页的 HTML 能拿到、脚本却 401，
// 表现是「登录页白屏」，且因为 HTML 本身是 200，排查时极易误判成前端故障。
// 因此这两个中间件的位置在这里显式写死，而不是交给框架的自动插入顺序。
app.UseStaticFiles();
app.UseAuthentication();
app.UseMiddleware<TenantHostContextMiddleware>();
app.UseAuthorization();
// 限流中间件：基于端点元数据（RequireRateLimiting）生效，须在认证之后（限流分区取真实 IP 依赖
// ForwardedHeaders 已处理）、端点执行之前。
app.UseRateLimiter();

var antiforgery = app.Services.GetRequiredService<IAntiforgery>();

// BFF API 端点。以下匿名豁免各条都有「为什么可以匿名」的理由；其余端点默认走 FallbackPolicy。

// 登录挑战：全页导航入口（SPA 不经 XHR 调它；302 到 IDP 授权端点）。
// 匿名是必需而非让步：登录入口本身不能要求已认证。returnUrl 经白名单校验防开放重定向。
// 带 error 查询参数（回调失败带回的 error 码）时不发起挑战，直接渲染极简错误页：
// 否则系统性故障（IDP 宕机/授权被拒/凭据失效）下用户在 admin↔IDP 之间 302 打转
// 直到触发限流 429，全程没有任何提示。这是 BFF 路由，天然先于 SPA 回退生效；
// 错误码经 LoginError 白名单折算、文案全部出自固定映射，不回显 IDP 原文。
app.MapGet("/admin/login", (string? returnUrl, string? error) =>
{
    if (!string.IsNullOrEmpty(error))
    {
        var sanitized = LoginReturnUrl.Sanitize(returnUrl);
        // 重试链接保留已白名单化的 returnUrl（相对引用语义，消费点仍是本端点的 Sanitize）。
        var retryHref = "/admin/login" + (sanitized == LoginReturnUrl.Fallback
            ? string.Empty
            : "?returnUrl=" + Uri.EscapeDataString(sanitized));
        return Results.Content(
            "<!doctype html><html lang=\"zh\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<title>登录失败</title><body style=\"font-family:system-ui;padding:3rem;max-width:40rem\">" +
            $"<h1 style=\"font-size:1.25rem\">登录失败</h1><p style=\"line-height:1.8\">{LoginError.Describe(error)}</p>" +
            $"<p><a href=\"{retryHref}\">重试登录</a>　<a href=\"/admin/\">回到首页</a></p>" +
            "</body></html>",
            "text/html; charset=utf-8");
    }

    return Results.Challenge(new AuthenticationProperties
    {
        RedirectUri = LoginReturnUrl.Sanitize(returnUrl),
    });
}).RequireRateLimiting("admin-login").AllowAnonymous();

// OIDC 回调：OpenIddict 客户端完成授权码 + PKCE 校验后落到这里建立会话。
// 匿名是必需的：回调发生在会话建立之前。
app.MapGet("/admin/callback/login/{provider}", async (HttpContext context) =>
{
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("PandaAuth.Admin.Callback");

    var result = await context.AuthenticateAsync(OpenIddictClientAspNetCoreDefaults.AuthenticationScheme);
    if (result is not { Succeeded: true } || result.Principal is null)
    {
        // 认证失败（IDP 拒绝授权、state 不符、码无效、令牌交换失败等）带回错误码重走挑战：
        // 裸 302 回登录入口会丢掉 EnableErrorPassthrough 送到眼前的 error 码，系统性故障下
        // 用户在 admin↔IDP 间打转直到限流 429，全程无提示。错误码来自失败结果的
        // AuthenticationProperties（OpenIddict 把响应 error 写入 .error 项，含 IDP 透传与
        // 本地校验失败两类）；error_description 等原文不透传——未约束输入不进重定向与页面。
        var error = result.Properties?.Items[OpenIddictClientAspNetCoreConstants.Properties.Error]
            ?? context.Request.Query["error"].ToString();
        if (string.IsNullOrEmpty(error))
        {
            error = LoginError.StateInvalid;
        }

        logger.LogWarning("登录回调认证失败（error={Error}）。", LoginError.Normalize(error));
        return Results.Redirect(LoginError.RedirectTarget(error));
    }

    var (identity, isAdmin) = AdminSessionIdentity.Build(result.Principal);

    if (!TenantHostContext.TryValidate(context, result.Principal, out var tenantReason))
    {
        logger.LogWarning(
            "管理后台登录被拒：OIDC 租户声明与请求主机不一致或主机未知（reason={Reason}, host={Host}）。",
            tenantReason,
            context.Request.Host.Host);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Results.Content(
            "<!doctype html><html lang=\"zh\"><meta charset=\"utf-8\"><title>403</title>" +
            "<body style=\"font-family:system-ui;padding:3rem\">租户入口与登录上下文不匹配。</body></html>",
            "text/html; charset=utf-8");
    }

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
    // 诊断日志降 Debug：回调属高频路径，Information 级在常态流量下只有刷屏价值。
    logger.LogDebug(
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

// 路由值的归一化还原：ASP.NET 路由对路由值做**部分**解码（%3F→? 等还原，但 %2F 保留转义
// 以维持路径段语义）。此处只负责 UnescapeDataString 还原成**原始 id**——统一转义由
// share 契约（PandaAuthAdminApi）负责，server/admin 两端共引一处；调用方若再自行
// EscapeDataString 会把 % 二次转义成 %25（配套 share PR：fix/admin-api-path-escaping）。
static string NormalizeRouteValue(string value) => Uri.UnescapeDataString(value);

// 变更类端点的防伪样板收敛：此前逐端点抄 try/catch（加端点 = 再抄一段，漏抄一段 = 该端点
// CSRF 裸奔）。端点只声明业务转发参数；防伪失败统一 400，行为与收敛前一致。
async Task<IResult> WithAntiforgeryAsync(HttpContext ctx, Func<Task<IResult>> handler)
{
    try
    {
        await antiforgery.ValidateRequestAsync(ctx);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    return await handler();
}

// 登出：防伪校验 → 撤销 IDP 令牌（尽力而为）→ 清本地会话 → RP 端到端登出（end-session）。
// 不匿名豁免：登出只对已登录会话有意义；匿名 POST 由 FallbackPolicy 拦下（302，前端仅在有会话时调用）。
app.MapPost("/admin/api/logout", (HttpContext context, TokenRevocationClient revocationClient) =>
    WithAntiforgeryAsync(context, async () =>
    {
        // 先取令牌再登出：Cookie 清除后票据内的令牌不可恢复。
        var (accessToken, refreshToken) = SessionTokens.Read(
            await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme));

        await revocationClient.RevokeAsync(
            accessToken,
            refreshToken,
            context.RequestAborted,
            TenantOidcRouting.ResolveIssuer(context.Request, issuer));
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        // RP 发起的前端登出：重定向到 IDP 的 end-session 端点（单点登出），再回 PostLogoutRedirectUri。
        return Results.SignOut(
            new AuthenticationProperties { RedirectUri = "/admin/" },
            [OpenIddictClientAspNetCoreDefaults.AuthenticationScheme]);
    }));

// ---- Admin 数据 API 代理端点（admin 0.3）----
// 全部落在 FallbackPolicy 下（需已认证）；变更类（POST/PUT/DELETE）经 WithAntiforgeryAsync；
// GET 透传查询串。上游路径取自 share 契约常量（PandaAuthAdminApi），两端不写 URL 字面量。
// 路由值一律经 NormalizeRouteValue（见上）还原为原始 id 后交给契约——统一转义在契约侧完成，
// 直拼（不还原）即把调用方可控内容注入上游 query/路径段（? 与 .. 皆然）。
async Task<string?> ReadJsonBodyAsync(HttpContext ctx)
{
    // Content-Length 为 null 不等于「没有体」：chunked（Transfer-Encoding）请求没有
    // Content-Length，此前被静默当空体，变更请求被无声丢弃、上游按无体处理。
    // 真没有体 = 长度 0，或既无长度也无 Transfer-Encoding。
    if (ctx.Request.ContentLength is 0)
    {
        return null;
    }

    if (ctx.Request.ContentLength is null && !ctx.Request.Headers.ContainsKey(HeaderNames.TransferEncoding))
    {
        return null;
    }

    using var reader = new StreamReader(ctx.Request.Body);
    return await reader.ReadToEndAsync(ctx.RequestAborted);
}

app.MapGet("/admin/api/users", (HttpContext ctx, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.Users + ctx.Request.QueryString.Value, HttpMethod.Get));

app.MapGet("/admin/api/users/{id}", (string id, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.User(NormalizeRouteValue(id)), HttpMethod.Get));

app.MapPost("/admin/api/users/{id}/status", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserStatus(NormalizeRouteValue(id)), HttpMethod.Post, await ReadJsonBodyAsync(ctx))));

app.MapPost("/admin/api/users/{id}/reset-password", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserResetPassword(NormalizeRouteValue(id)), HttpMethod.Post, await ReadJsonBodyAsync(ctx))));

app.MapPost("/admin/api/users", (HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.Users, HttpMethod.Post, await ReadJsonBodyAsync(ctx))));

app.MapGet("/admin/api/users/{id}/claims", (string id, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.UserClaims(NormalizeRouteValue(id)), HttpMethod.Get));

app.MapGet("/admin/api/roles", async (HttpContext context, AdminApiProxy proxy) =>
{
    var query = context.Request.QueryString.HasValue ? context.Request.QueryString.Value : string.Empty;
    return await proxy.ForwardAsync(PandaAuthAdminApi.Roles + query, HttpMethod.Get);
});

app.MapPost("/admin/api/users/{id}/claims", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserClaims(NormalizeRouteValue(id)), HttpMethod.Post, await ReadJsonBodyAsync(ctx))));

app.MapDelete("/admin/api/users/{id}/claims/{claimId:long}", (string id, long claimId, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserClaim(NormalizeRouteValue(id), claimId), HttpMethod.Delete)));

app.MapGet("/admin/api/roles/{id}/claims", (string id, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.RoleClaims(NormalizeRouteValue(id)), HttpMethod.Get));

app.MapPost("/admin/api/roles/{id}/claims", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.RoleClaims(NormalizeRouteValue(id)), HttpMethod.Post, await ReadJsonBodyAsync(ctx))));

app.MapDelete("/admin/api/roles/{id}/claims/{claimId:long}", (string id, long claimId, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.RoleClaim(NormalizeRouteValue(id), claimId), HttpMethod.Delete)));

app.MapPut("/admin/api/users/{id}/roles", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserRoles(NormalizeRouteValue(id)), HttpMethod.Put, await ReadJsonBodyAsync(ctx))));

app.MapPost("/admin/api/users/{id}/unlock", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserUnlock(NormalizeRouteValue(id)), HttpMethod.Post)));

app.MapPut("/admin/api/users/{id}/profile", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserProfile(NormalizeRouteValue(id)), HttpMethod.Put, await ReadJsonBodyAsync(ctx))));

app.MapPost("/admin/api/users/{id}/reset-2fa", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserResetTwoFactor(NormalizeRouteValue(id)), HttpMethod.Post)));

app.MapPost("/admin/api/users/{id}/deactivate", (string id, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.UserDeactivate(NormalizeRouteValue(id)), HttpMethod.Post, await ReadJsonBodyAsync(ctx))));

app.MapGet("/admin/api/clients", (HttpContext ctx, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.Clients + ctx.Request.QueryString.Value, HttpMethod.Get));

app.MapGet("/admin/api/clients/options", (AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.ClientOptions, HttpMethod.Get));

app.MapGet("/admin/api/clients/{clientId}", (string clientId, AdminApiProxy proxy)
    => proxy.ForwardAsync(PandaAuthAdminApi.Client(NormalizeRouteValue(clientId)), HttpMethod.Get));

app.MapPut("/admin/api/clients/{clientId}/redirect-uris", (string clientId, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.ClientRedirectUris(NormalizeRouteValue(clientId)), HttpMethod.Put, await ReadJsonBodyAsync(ctx))));

app.MapPut("/admin/api/clients/{clientId}/permissions", (string clientId, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.ClientPermissions(NormalizeRouteValue(clientId)), HttpMethod.Put, await ReadJsonBodyAsync(ctx))));

app.MapPost("/admin/api/clients/{clientId}/rotate-secret", (string clientId, HttpContext ctx, AdminApiProxy proxy) =>
    WithAntiforgeryAsync(ctx, async () => await proxy.ForwardAsync(PandaAuthAdminApi.ClientRotateSecret(NormalizeRouteValue(clientId)), HttpMethod.Post)));

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
