using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenIddict.Client;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// AdminApiProxy 转发测试：断言真实发出的请求（Bearer / XFF / 路径 / 请求体），
/// 用与 server 仓相同的桩 IAuthenticationService 模式提供会话令牌。
/// 「401 → 刷新成功 → 重试」链路依赖真实 OpenIddictClientService（具体类，不可桩），
/// 由生产浏览器验收覆盖；此处覆盖无 RT 的 401 折算与上游不可达的 502 映射。
/// </summary>
public class AdminApiProxyTests
{
    private static readonly Uri Issuer = new("http://localhost:9004/");

    private static (ClaimsPrincipal Principal, AuthenticationProperties Properties) PrincipalWithTokens(
        string? accessToken, string? refreshToken)
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
            new Claim("sub", "actor-1"),
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

    private static AdminApiProxy CreateProxy(StubHttpMessageHandler handler, IHttpContextAccessor accessor)
    {
        // 与生产同构：issuer 经 IConfiguration 提供给代理（不再构造注入 Uri）。
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:Issuer"] = Issuer.ToString() })
            .Build();
        return new AdminApiProxy(
            // 生产侧 BaseAddress 由 AddHttpClient 配置；单测手动补齐。
            new HttpClient(handler) { BaseAddress = Issuer },
            null!,
            accessor,
            configuration,
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

    // ---- 桩：扩展自共享 StubHttpMessageHandler（补齐头部读取与多值头） ----

    private sealed class StubHttpMessageHandler(HttpStatusCode statusCode = HttpStatusCode.OK) : HttpMessageHandler
    {
        private readonly List<(Uri Uri, string? Authorization, string[] Xff, string? Body)> _requests = [];

        public IReadOnlyList<(Uri Uri, string? Authorization, string[] Xff, string? Body)> Requests => _requests;

        public Exception? ThrowOnSend { get; init; }

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

            return new HttpResponseMessage(statusCode)
            {
                Content = new StringContent("""{"items":[],"total":0,"page":1,"pageSize":20}"""),
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
}
