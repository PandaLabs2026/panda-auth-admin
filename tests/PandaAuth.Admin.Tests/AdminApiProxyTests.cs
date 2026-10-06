using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// AdminApiProxy 转发测试：断言真实发出的请求（Bearer / XFF / 路径 / 请求体），
/// 用与 server 仓相同的桩 IAuthenticationService 模式提供会话令牌。
/// 刷新链路经 IAdminSessionRefresher 接缝注入桩（OpenIddictClientService 的刷新方法非虚、
/// 具体类无法继承重写），覆盖：无 RT 的 401 折算、上游不可达/超时的 502 映射、
/// 请求方取消的重抛、并发 401 共享同一只一次性 RT 的刷新单飞。
/// </summary>
public class AdminApiProxyTests
{
    private static readonly Uri Issuer = new("http://localhost:9004/");

    private static (ClaimsPrincipal Principal, AuthenticationProperties Properties) PrincipalWithTokens(
        string? accessToken, string? refreshToken, string subject = "actor-1")
    {
        var properties = new AuthenticationProperties();
        var tokens = new List<AuthenticationToken>();
        if (accessToken is not null)
        {
            tokens.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = accessToken });
        }

        if (refreshToken is not null)
        {
            tokens.Add(new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = refreshToken });
        }

        if (tokens.Count > 0)
        {
            properties.StoreTokens(tokens);
        }

        var identity = new ClaimsIdentity(
        [
            new Claim("sub", subject),
            new Claim("role", PandaAuthRoles.Admin),
        ], CookieAuthenticationDefaults.AuthenticationScheme, "name", "role");
        return (new ClaimsPrincipal(identity), properties);
    }

    private static HttpContext ContextWithTokens(string? accessToken, string? refreshToken)
    {
        // 桩的 AuthenticateAsync 必须返回**带令牌的同一份 properties**——
        // 代理正是从 AuthenticateResult.Properties.GetTokenValue 取 AT/RT 的。
        var (principal, properties) = PrincipalWithTokens(accessToken, refreshToken);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IAuthenticationService>(new StubAuthenticationService(principal, properties));
        var http = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            User = principal,
        };
        http.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("203.0.113.9");
        return http;
    }

    private static AdminApiProxy CreateProxy(
        StubHttpMessageHandler handler,
        IHttpContextAccessor accessor,
        IAdminSessionRefresher? sessionRefresher = null)
    {
        return new AdminApiProxy(
            // 生产侧 BaseAddress 由 AddHttpClient 配置；单测手动补齐。
            new HttpClient(handler) { BaseAddress = Issuer },
            sessionRefresher ?? null!,
            accessor,
            new Logger<AdminApiProxy>(Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance));
    }

    private static async Task<int> StatusOfAsync(IResult result)
    {
        // Results（Unauthorized/Problem）执行时要从 RequestServices 解析服务，裸 HttpContext 会 NRE。
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        };
        await result.ExecuteAsync(http);
        return http.Response.StatusCode;
    }

    /// <summary>执行透传结果并回读状态码/响应头/响应体（403 标记断言需要头与体）。</summary>
    private static async Task<(int Status, IHeaderDictionary Headers, string Body)> ExecuteAsync(IResult result)
    {
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        };
        // DefaultHttpContext 的响应体默认是 Stream.Null：写入无处可去，须显式挂内存流。
        http.Response.Body = new MemoryStream();
        await result.ExecuteAsync(http);
        http.Response.Body.Position = 0;
        using var reader = new StreamReader(http.Response.Body);
        return (http.Response.StatusCode, http.Response.Headers, await reader.ReadToEndAsync());
    }

    [Fact]
    public async Task Forward_AttachesBearerXffPathAndBody()
    {
        var handler = new StubHttpMessageHandler();
        var context = ContextWithTokens("token-1", "refresh-1");
        var accessor = new StubHttpContextAccessor(context);

        var result = CreateProxy(handler, accessor);
        var response = await result.ForwardAsync(
            PandaAuthAdminApi.Users + "?page=2&query=ali",
            HttpMethod.Get,
            cancellationToken: CancellationToken.None);

        var status = await StatusOfAsync(response);
        Assert.Equal(StatusCodes.Status200OK, status);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("http://localhost:9004" + PandaAuthAdminApi.Users + "?page=2&query=ali", request.Uri.ToString());
        Assert.Equal("Bearer token-1", request.Authorization);
        // XFF 透传的是 BFF 已还原的真实客户端 IP。
        Assert.Contains("203.0.113.9", request.Xff);
    }

    [Fact]
    public async Task Forward_PassesThroughUpstreamErrorStatusAndBody()
    {
        var handler = new StubHttpMessageHandler(HttpStatusCode.BadRequest);
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.UserStatus("u-1"), HttpMethod.Post, """{"status":9}""");

        Assert.Equal(StatusCodes.Status400BadRequest, await StatusOfAsync(response));
    }

    [Fact]
    public async Task Forward_Upstream401WithoutRefreshToken_Yields401_SingleAttempt()
    {
        var handler = new StubHttpMessageHandler(HttpStatusCode.Unauthorized);
        var accessor = new StubHttpContextAccessor(ContextWithTokens("stale-token", refreshToken: null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.Users, HttpMethod.Get);

        Assert.Equal(StatusCodes.Status401Unauthorized, await StatusOfAsync(response));
        // 无 RT 不做刷新，也就没有第二次请求。
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task Forward_NoSessionToken_Yields401_WithoutCallingUpstream()
    {
        var handler = new StubHttpMessageHandler();
        var accessor = new StubHttpContextAccessor(ContextWithTokens(null, null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.Users, HttpMethod.Get);

        Assert.Equal(StatusCodes.Status401Unauthorized, await StatusOfAsync(response));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Forward_UpstreamUnreachable_Yields502()
    {
        var handler = new StubHttpMessageHandler { ThrowOnSend = new HttpRequestException("connection refused") };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", "refresh-1"));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.Users, HttpMethod.Get);

        Assert.Equal(StatusCodes.Status502BadGateway, await StatusOfAsync(response));
    }

    [Fact]
    public async Task Forward_HttpClientTimeout_Yields502()
    {
    [Fact]
    public async Task Forward_HttpClientTimeout_Yields502()
    {
        // HttpClient.Timeout 到点抛 TaskCanceledException 且不置调用方 token——此前只
        // catch HttpRequestException，超时漏成裸 500；必须与不可达同样折算 502。
        var handler = new StubHttpMessageHandler { ThrowOnSend = new TaskCanceledException("timeout") };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", "refresh-1"));


        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.Users, HttpMethod.Get);
        Assert.Equal(StatusCodes.Status502BadGateway, await StatusOfAsync(response));
    }

    }

    [Fact]
    public async Task Forward_RequestorCancelled_RethrowsInsteadOf502()
    {
        // 请求方取消（浏览器断开）同样以 TaskCanceledException 冒泡，但 token 已置位——
        // 语义是「客户端不等了」而非「上游故障」，必须原样上抛，不能折算 502 掩盖。
        var handler = new StubHttpMessageHandler { ThrowOnSend = new TaskCanceledException("aborted") };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", "refresh-1"));
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAsync<TaskCanceledException>(() =>
            CreateProxy(handler, accessor).ForwardAsync(
                PandaAuthAdminApi.Users, HttpMethod.Get, cancellationToken: cts.Token));
    }

    [Fact]
    public async Task Forward_Concurrent401s_LateArrivingRequest_RefreshesOnceViaTicketReread()
    {
        // 刷新完成后到达的请求（浏览器已吃到 Set-Cookie）：单飞层一——重读票据即见新 AT。
        // subject 与其它并发用例互异：刷新闸门按 subject 落在 static 字典，避免用例间串味。
        await RunConcurrent401sAsync(freezeRequestCookie: false, subject: "actor-reread");
    }

    [Fact]
    public async Task Forward_Concurrent401s_InFlightRequest_RefreshesOnceViaWinnerReuse()
    {
        // 真实浏览器语义：在途请求的 Cookie 在发送时已定格，重读票据仍是旧 RT——
        // 只能走单飞层二（复用同 subject 赢家刚换出的新 AT）。生产并发 401 正是这条路径。
        await RunConcurrent401sAsync(freezeRequestCookie: true, subject: "actor-inflight");
    }

    /// <summary>
    /// 并发两个 401 共享同一只一次性 RT 的单飞断言：IDP 桩只收到一次刷新、两个请求都成功，
    /// 且会话回写保留原票据的持久化属性。两个用例分别钉住层一（票据重读）与层二（赢家复用）。
    /// </summary>
    private static async Task RunConcurrent401sAsync(bool freezeRequestCookie, string subject)
    {
        var (principal, properties) = PrincipalWithTokens("token-1", "refresh-1", subject);
        properties.IsPersistent = true;
        properties.ExpiresUtc = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var jar = new BrowserCookieJar(principal, properties);
        var context1 = ContextFromJar(jar, freezeRequestCookie, principal);
        var context2 = ContextFromJar(jar, freezeRequestCookie, principal);

        var refresh = new StubRefreshClient(TimeSpan.FromMilliseconds(150));
        var proxy1 = CreateProxy(
            new StubHttpMessageHandler { RejectBearerToken = "token-1" }, new StubHttpContextAccessor(context1), refresh);
        var proxy2 = CreateProxy(
            new StubHttpMessageHandler { RejectBearerToken = "token-1" }, new StubHttpContextAccessor(context2), refresh);

        var first = Task.Run(() => proxy1.ForwardAsync(PandaAuthAdminApi.Users, HttpMethod.Get));
        var second = Task.Run(() => proxy2.ForwardAsync(PandaAuthAdminApi.Users, HttpMethod.Get));
        var responses = await Task.WhenAll(first, second);

        Assert.Equal(StatusCodes.Status200OK, await StatusOfAsync(responses[0]));
        Assert.Equal(StatusCodes.Status200OK, await StatusOfAsync(responses[1]));

        // 单飞：IDP 桩只收到一次刷新，用的正是出发时那只 RT。
        Assert.Equal("refresh-1", Assert.Single(refresh.RefreshTokens));

        // 会话回写：新令牌就位，且票据持久化属性（IsPersistent/ExpiresUtc）原样继承——
        // 刷新是常态路径，重置即等于每次续满 2 小时窗口、改写「记住我」语义。
        var rewritten = jar.ReadTicket().Properties;
        Assert.Equal("token-2", rewritten.GetTokenValue(SessionTokens.AccessTokenName));
        Assert.Equal("refresh-2", rewritten.GetTokenValue(SessionTokens.RefreshTokenName));
        Assert.True(rewritten.IsPersistent);
        Assert.Equal(properties.ExpiresUtc, rewritten.ExpiresUtc);
    }

    private static HttpContext ContextFromJar(BrowserCookieJar jar, bool freezeRequestCookie, ClaimsPrincipal principal)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IAuthenticationService>(new JarAuthenticationService(jar, freezeRequestCookie));
        var http = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            User = principal,
        };
        http.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("203.0.113.9");
        return http;
    // ---- 403 语义二分：只有带 MFA 标记的上游 403 才附加 X-Panda-Mfa-Required ----

    [Fact]
    public async Task Forward_Upstream403WithMfaMarker_AddsMfaHeaderAndKeepsBody()
    {
        var body = """{"title":"需要完成 MFA 验证","extensions":{"mfaRequired":true}}""";
        var handler = new StubHttpMessageHandler(HttpStatusCode.Forbidden) { Body = body };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.UserStatus("u-1"), HttpMethod.Post);

        var (status, headers, responseBody) = await ExecuteAsync(response);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.Equal("true", headers["X-Panda-Mfa-Required"].ToString());
        // 响应体原样透传：前端仍可读取 ProblemDetails 文案。
        Assert.Equal(body, responseBody);
    }

    [Fact]
    public async Task Forward_Upstream403TopLevelMarker_AddsMfaHeader()
    {
        // snake_case 顶层标记同样认（协议层惯例；camelCase 是 MVC 序列化惯例）。
        var handler = new StubHttpMessageHandler(HttpStatusCode.Forbidden)
        {
            Body = """{"error":"forbidden","mfa_required":true}""",
        };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.UserStatus("u-1"), HttpMethod.Post);

        var (status, headers, _) = await ExecuteAsync(response);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.Equal("true", headers["X-Panda-Mfa-Required"].ToString());
    }

    [Fact]
    public async Task Forward_Upstream403PlainProblemDetails_NoMfaHeader()
    {
        // 真正的权限拒绝（ProblemDetails 无标记字段）：不加头，前端按普通错误展示。
        var handler = new StubHttpMessageHandler(HttpStatusCode.Forbidden)
        {
            Body = """{"title":"无权限","detail":"该操作需要更高权限。"}""",
        };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.UserStatus("u-1"), HttpMethod.Post);

        var (status, headers, _) = await ExecuteAsync(response);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.False(headers.ContainsKey("X-Panda-Mfa-Required"));
    }

    [Fact]
    public async Task Forward_Upstream403EmptyBody_MarksMfaHeader_Transitional()
    {
        // 过渡期兼容（钉住 server 现状）：server 仓 15 处 MFA/WebAuthn 门禁全部是裸 Forbid()，
        // 空体 403 且无任何标记——不按 step-up 处理的话，管理员做门禁操作只能看到裸 HTTP 403、
        // 无法从 UI 进入 step-up。server 侧补上 mfaRequired 标记后应删除该过渡分支
        // （IsMfaGate 的空体短路与本测试需同步退役）。
        var handler = new StubHttpMessageHandler(HttpStatusCode.Forbidden) { Body = string.Empty };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.UserStatus("u-1"), HttpMethod.Post);

        var (status, headers, _) = await ExecuteAsync(response);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.Equal("true", headers["X-Panda-Mfa-Required"].ToString());
    }

    [Fact]
    public async Task Forward_Upstream403MarkerFalse_NoMfaHeader()
    {
        // 只认布尔真：字符串/数字/显式 false 都不算命中。
        var handler = new StubHttpMessageHandler(HttpStatusCode.Forbidden)
        {
            Body = """{"mfaRequired":false,"other":"mfaRequired"}""",
        };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.UserStatus("u-1"), HttpMethod.Post);

        var (_, headers, _) = await ExecuteAsync(response);
        Assert.False(headers.ContainsKey("X-Panda-Mfa-Required"));
    }

    [Fact]
    public async Task Forward_UpstreamNon403WithMarker_NoMfaHeader()
    {
        // 标记头只在 403 透传时附加；其它状态码即使体里带同名字段也不加。
        var handler = new StubHttpMessageHandler(HttpStatusCode.OK)
        {
            Body = """{"mfaRequired":true}""",
        };
        var accessor = new StubHttpContextAccessor(ContextWithTokens("token-1", null));

        var response = await CreateProxy(handler, accessor).ForwardAsync(
            PandaAuthAdminApi.Users, HttpMethod.Get);
        var (status, headers, _) = await ExecuteAsync(response);
        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.False(headers.ContainsKey("X-Panda-Mfa-Required"));
    }

    }

    // ---- 桩：扩展自共享 StubHttpMessageHandler（补齐头部读取与多值头） ----

    private sealed class StubHttpMessageHandler(HttpStatusCode statusCode = HttpStatusCode.OK) : HttpMessageHandler
    {
        private readonly List<(Uri Uri, string? Authorization, string[] Xff, string? Body)> _requests = [];

        public IReadOnlyList<(Uri Uri, string? Authorization, string[] Xff, string? Body)> Requests => _requests;

        public Exception? ThrowOnSend { get; init; }

        /// <summary>上游响应体覆写（缺省回桩内置 JSON）；空串表示空体（server 侧 Forbid 的形态）。</summary>
        public string? Body { get; init; }

        /// <summary>携带该 AT 的上游请求按 401 回（模拟 AT 过期触发刷新重试链路）。</summary>
        public string? RejectBearerToken { get; init; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            _requests.Add((
                request.RequestUri!,
                request.Headers.Authorization?.ToString(),
                request.Headers.TryGetValues("X-Forwarded-For", out var values) ? values.ToArray() : [],
                body));
            if (ThrowOnSend is not null)
            {
                throw ThrowOnSend;
            }

            var status = RejectBearerToken is not null
                && string.Equals(request.Headers.Authorization?.Parameter, RejectBearerToken, StringComparison.Ordinal)
                ? HttpStatusCode.Unauthorized
                : statusCode;
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(
                    Body ?? """{"items":[],"total":0,"page":1,"pageSize":20}""",
                    Encoding.UTF8,
                    Body is null ? "application/json" : "application/problem+json"),
            };
        }
    }

    private sealed class StubHttpContextAccessor(HttpContext context) : IHttpContextAccessor
    {
        public HttpContext? HttpContext { get; set; } = context;
    }

    private sealed class StubAuthenticationService(ClaimsPrincipal principal, AuthenticationProperties properties) : IAuthenticationService
    {
        public Task<AuthenticateResult> AuthenticateAsync(HttpContext context, string? scheme)
            => Task.FromResult(AuthenticateResult.Success(
                new AuthenticationTicket(principal, properties, CookieAuthenticationDefaults.AuthenticationScheme)));

        public Task ChallengeAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task ForbidAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task SignInAsync(HttpContext context, string? scheme, ClaimsPrincipal user, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task SignOutAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
    }

    /// <summary>
    /// 模拟浏览器 Cookie 仓：SignInAsync 即 Set-Cookie 回写，AuthenticateAsync 即解当前票据。
    /// </summary>
    private sealed class BrowserCookieJar(ClaimsPrincipal principal, AuthenticationProperties properties)
    {
        private (ClaimsPrincipal Principal, AuthenticationProperties Properties) _ticket = (principal, properties);

        public AuthenticationTicket ReadTicket()
            => new(_ticket.Principal, _ticket.Properties, CookieAuthenticationDefaults.AuthenticationScheme);

        public void WriteTicket(ClaimsPrincipal user, AuthenticationProperties properties) => _ticket = (user, properties);
    }

    /// <summary>
    /// 挂接 <see cref="BrowserCookieJar"/> 的认证桩。<paramref name="freezeRequestCookie"/> 决定
    /// 请求内重读票据的可见性：true 模拟真实浏览器（请求 Cookie 在发送时定格，服务端重读仍是旧值，
    /// 只有 SignInAsync 之后**新发起**的请求才见新票据）；false 模拟「请求晚于 Set-Cookie 到达」。
    /// </summary>
    private sealed class JarAuthenticationService(BrowserCookieJar jar, bool freezeRequestCookie) : IAuthenticationService
    {
        private AuthenticationTicket? _requestTicket;

        public Task<AuthenticateResult> AuthenticateAsync(HttpContext context, string? scheme)
        {
            if (freezeRequestCookie)
            {
                // 请求 Cookie 发送时定格：本次请求内的每次重读都返回同一份快照。
                _requestTicket ??= jar.ReadTicket();
                return Task.FromResult(AuthenticateResult.Success(_requestTicket));
            }

            return Task.FromResult(AuthenticateResult.Success(jar.ReadTicket()));
        }

        public Task SignInAsync(HttpContext context, string? scheme, ClaimsPrincipal user, AuthenticationProperties? properties)
        {
            if (properties is not null)
            {
                jar.WriteTicket(user, properties);
            }

            return Task.CompletedTask;
        }

        public Task ChallengeAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task ForbidAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task SignOutAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
    }

    /// <summary>
    /// 会话刷新桩：记录刷新用掉的 RT 并回放固定轮换（token-1/refresh-1 → token-2/refresh-2）。
    /// latency 人为拉开刷新耗时，让并发用例的第二个 401 确切落在刷新进行中（竞争窗口真实化）。
    /// </summary>
    private sealed class StubRefreshClient(TimeSpan latency) : IAdminSessionRefresher
    {
        private readonly ConcurrentQueue<string> _refreshTokens = [];

        public IReadOnlyList<string> RefreshTokens => _refreshTokens.ToArray();

        public async Task<RefreshedTokens> RefreshAsync(HttpContext context, string refreshToken, CancellationToken cancellationToken)
        {
            _refreshTokens.Enqueue(refreshToken);
            await Task.Delay(latency, cancellationToken);
            return new RefreshedTokens("token-2", "refresh-2");
        }
    }
}
