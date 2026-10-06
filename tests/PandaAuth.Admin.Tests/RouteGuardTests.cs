using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PandaAuth.Shared;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// BFF 路由守卫集成测试（真实 Program.cs，经 WebApplicationFactory）。
/// </summary>
/// <remarks>
/// <para>
/// 钉住两组既有缺陷的回归：①FallbackPolicy 默认拒绝——未映射的 /admin/api/* 路径必须
/// 被授权拦下，而不是被 SPA 回退接走返回 200 + index.html（2026-09-16 在 /admin/api/session、
/// /admin/api/users 上实测发生过）；②已删除的 501 登录端点不得以任何形态复活。
/// </para>
/// <para>
/// 挑战方案替换为桩：OpenIddict 客户端的挑战需要连真实 IDP 做 discovery，测试环境没有。
/// 替换只改「挑战的表现形式」（302 → 确定性 401/403），不改变任何端点的授权判定本身。
/// </para>
/// </para>
/// </remarks>
public class RouteGuardTests
{
    private sealed class GuardFactory(bool authenticated) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // Development 环境提供 dev ClientSecret（appsettings.Development.json）；
            // Program.cs 对空密钥失败关闭，用 Production 配置起不来。
            builder.UseEnvironment("Development");
            builder.ConfigureServices(services =>
            {
                services.AddAuthentication()
                    .AddScheme<AuthenticationSchemeOptions, StubChallengeHandler>("StubChallenge", _ => { })
                    .AddScheme<AuthenticationSchemeOptions, StubAuthenticatedHandler>("StubAuthenticated", _ => { });
                // PostConfigure 在 Program.cs 的 AddAuthentication 之后执行，覆盖默认方案。
                services.PostConfigure<AuthenticationOptions>(options =>
                {
                    options.DefaultChallengeScheme = "StubChallenge";
                    if (authenticated)
                    {
                        // 认证桩：所有请求自动携带 admin 身份，验证「已认证」分支的 404/200 行为。
                        options.DefaultAuthenticateScheme = "StubAuthenticated";
                    }
                });
            });
        }
    }

    /// <summary>
    /// 代理转发桩工厂：真实 Cookie 方案 + 直签会话票据（直通格式器），并把代理 typed client 的
    /// 上游 handler 换成记录桩——据此断言「路由值转义后拼出的上游路径」这一 BFF 层行为
    /// （AdminApiProxyTests 只能断言代理本身，覆盖不到 Program.cs 端点处的转义拼装）。
    /// </summary>
    private sealed class ProxySpyFactory : WebApplicationFactory<Program>
    {
        /// <summary>直通 IDataProtector：票据格式器只做序列化/编码，不加密——测试可两侧同构。</summary>
        private sealed class PassThroughProtector : IDataProtector
        {
            public IDataProtector CreateProtector(string purpose) => this;
            public byte[] Protect(byte[] plaintext) => plaintext;
            public byte[] Unprotect(byte[] protectedData) => protectedData;
        }

        /// <summary>上游记录桩：记录真实发出的请求 URI，回固定 200 JSON。</summary>
        public sealed class RecordingHandler : HttpMessageHandler
        {
            private readonly List<Uri> _requests = [];

            public IReadOnlyList<Uri> Requests => _requests;

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                _requests.Add(request.RequestUri!);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"items":[],"total":0,"page":1,"pageSize":20}""", Encoding.UTF8, "application/json"),
                });
            }
        }

        public RecordingHandler Spy { get; } = new();

        private readonly SecureDataFormat<AuthenticationTicket> _ticketFormat =
            new(TicketSerializer.Default, new PassThroughProtector());

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureServices(services =>
            {
                // 换掉 Cookie 方案的票据格式器：真实 DataProtection 密钥环在测试里无从预置，
                // 直通格式器让测试能以同一格式直签带 access_token 的会话票据（Cookie 名与
                // 方案名仍是生产的 PandaAuth.Admin / Cookies）。
                services.PostConfigure<CookieAuthenticationOptions>(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    options => options.TicketDataFormat = _ticketFormat);
                // 代理 typed client 的上游 handler 换成记录桩（对所有 HttpClientFactory 生效）。
                services.ConfigureAll<HttpClientFactoryOptions>(options =>
                    options.HttpMessageHandlerBuilderActions.Add(build => build.PrimaryHandler = Spy));
            });
        }

        /// <summary>直签带 access_token 的会话票据 Cookie 值（代理见到 AT 才会真正发上游请求）。</summary>
        public string MintSessionCookie()
        {
            var identity = new ClaimsIdentity(
            [
                new Claim(Claims.Subject, "spy-admin"),
                new Claim(Claims.Role, PandaAuthRoles.Admin),
            ], CookieAuthenticationDefaults.AuthenticationScheme, Claims.Name, Claims.Role);
            var properties = new AuthenticationProperties();
            properties.StoreTokens(
            [
                new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = "token-spy" },
            ]);
            return _ticketFormat.Protect(new AuthenticationTicket(new ClaimsPrincipal(identity), properties,
                CookieAuthenticationDefaults.AuthenticationScheme));
        }
    }

    [Fact]
    public async Task Anonymous_SessionEndpoint_Returns401_NotLoginRedirect()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/session");

        // 刻意的 401（端点内手动返回）：走 FallbackPolicy 会得到 302 登录跳转，
        // 前端拿到登录页 HTML 无法判定「未登录」。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_UnknownApiPath_Returns401_NotSpaFallback()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/unknown");

        // 受保护前缀兜底 + 授权：匿名先被拦（401），绝不能落到 SPA 回退返回 200 + index.html。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Authenticated_ProxyEscapesRouteValues_InUpstreamPath()
    {
        using var factory = new ProxySpyFactory();
        using var client = factory.CreateClient();
        // 真实 Cookie 会话票据（测试格式器直签）：代理从票据取 AT 才会真正发出上游请求。
        client.DefaultRequestHeaders.Add("Cookie", "PandaAuth.Admin=" + factory.MintSessionCookie());

        // 路由值含 / ? .. 等保留字符（%2F/%3F 不拆段，路由值解码回原样）：
        // BFF 必须整体转义后再拼上游路径，否则 ?x=1 漏进上游 query、.. 被当作路径段导航。
        using var response = await client.GetAsync("/admin/api/users/u%2F1%3Fx%3D1%2F..%2Fevil/claims");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var upstream = Assert.Single(factory.Spy.Requests);
        Assert.EndsWith(
            "/admin-api/claims/users/u%2F1%3Fx%3D1%2F..%2Fevil",
            upstream.AbsolutePath,
            StringComparison.Ordinal);
        // 原路由值里的 ?x=1 不得在上游以 query 形态出现——整段保持转义后的单一路径段。
        Assert.Equal(string.Empty, upstream.Query);
    }

    [Fact]
    public async Task Anonymous_RemovedLoginApiEndpoint_Returns401_NotSpaFallback()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        // 旧 501 占位端点已删除：匿名访问落到受保护兜底（401），而不是 501 或登录页 HTML。
        using var response = await client.PostAsync("/admin/api/auth/login", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_LoginChallengeEndpoint_IsAnonymousAndChallenges()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/login");

        // 401 来自挑战桩（真实环境是 302 到 IDP 授权端点）：证明端点匿名可达且触发挑战，
        // 不是 403（被授权拒）或 404（路由缺失）。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AntiforgeryEndpoint_ReturnsToken()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/antiforgery");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<AntiforgeryResponse>();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrEmpty(payload.Token));
    }

    [Fact]
    public async Task HealthCheckEndpoint_ReturnsHealthy()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SpaFallback_ServesIndexHtml_ForNonFileNonApiPaths()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/users");

        // SPA 外壳匿名可达（登录页由它承载）；放行的是外壳，不是数据。
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Authenticated_UnknownApiPath_Returns404()
    {
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/unknown");

        // 已认证 → 越过授权，路径确实不存在 → 404（区分「路径拼错」与「端点漏加授权」的前提）。
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Authenticated_SessionEndpoint_ReturnsIdentityWithRoles()
    {
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<SessionResponse>();
        Assert.NotNull(payload);
        Assert.Equal("stub-admin", payload.Subject);
        Assert.Contains("admin", payload.Roles);
    }

    [Fact]
    public async Task Authenticated_AdminProxyEndpoint_ActivatesAndMapsUpstreamUnreachable()
    {
        // 钉住 typed client 的 DI 激活路径：曾因构造注入 Uri 不可解析，每个代理请求 500
        // （2026-09-19 生产事故；单元测试手工 new 构造绕过了激活，故必须经真实管线测）。
        // WAF 的认证 stub 没有会话票据（无 AT）→ 代理按未认证折算 401。
        // 该断言足以钉住激活路径：DI 激活失败时这里是 500（未处理异常），而非 401。
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/users");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Authenticated_RoleDirectoryProxy_IsMappedBeforeProtectedFallback()
    {
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/roles?query=admin&page=1&pageSize=20");

        // 已映射到 BFF 后会进入代理并因测试上下文无 AT 返回 401；若漏映射则会越过兜底授权得到 404。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("/admin/api/users/user-1/claims")]
    [InlineData("/admin/api/roles/role-1/claims")]
    public async Task Authenticated_ClaimsProxyEndpoints_AreMappedBeforeProtectedFallback(string path)
    {
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(path);

        // 已映射到 BFF 后会进入代理并因测试上下文无 AT 返回 401；若漏映射则会越过兜底授权得到 404。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task LoginChallenge_RateLimited_AfterTenPerMinute()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        // 前 10 次（PermitLimit=10）：挑战桩 → 401。
        for (var i = 0; i < 10; i++)
        {
            using var response = await client.GetAsync("/admin/login");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        // 第 11 次：429。分区键是 RemoteIpAddress（TestServer 下恒定），串行请求计数确定。
        using var limited = await client.GetAsync("/admin/login");
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);

        // 限流只挂在 /admin/login：其他匿名端点不受该分区影响。
        using var session = await client.GetAsync("/admin/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, session.StatusCode);
    }

    private sealed record AntiforgeryResponse(string Token);

    private sealed record SessionResponse(string Subject, string? Name, string? Email, string? Nickname, string[] Roles);

    /// <summary>挑战桩：把「需要登录」表现成确定性 401（真实环境是 302 到 IDP）。</summary>
    private sealed class StubChallengeHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public StubChallengeHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
            => Task.FromResult(AuthenticateResult.NoResult());

        protected override Task HandleChallengeAsync(AuthenticationProperties properties)
        {
            Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        }

        protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
        {
            Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }
    }

    /// <summary>认证桩：携带 admin 身份（sub/name/roles 与 OIDC 短名 ClaimType 对齐）。</summary>
    private sealed class StubAuthenticatedHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public StubAuthenticatedHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var identity = new ClaimsIdentity(
            [
                new Claim(Claims.Subject, "stub-admin"),
                new Claim(Claims.Name, "Stub Admin"),
                new Claim(Claims.Role, "admin"),
            ], Scheme.Name, Claims.Name, Claims.Role);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
