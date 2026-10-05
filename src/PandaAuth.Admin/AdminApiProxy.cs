using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using OpenIddict.Client;

namespace PandaAuth.Admin;

/// <summary>
/// BFF → IDP Admin 数据 API 的代理：转发请求（Bearer AT + 原始客户端 IP 透传），
/// 上游 401 时用 refresh token 换新令牌（重写会话 Cookie）后重试一次。
/// </summary>
/// <remarks>
/// <para>AT 有效期仅 10 分钟而会话 2 小时——刷新不是边角，是常规路径。
/// OpenIddict 的 refresh token 是一次性的：换到的新 AT/RT **必须**随 SignInAsync 回写会话，
/// 否则下一次刷新或登出撤销都会拿着已作废的旧 RT 失败。</para>
/// <para>X-Forwarded-For 透传：本 BFF 的 ForwardedHeaders 已把 Caddy 传入的真实客户端 IP
/// 还原到 Connection.RemoteIpAddress；再作为 XFF 转给 IDP（IDP 同样只信任回环代理），
/// 管理审计于是记录到真人 IP 而非 127.0.0.1。</para>
/// </remarks>
public sealed class AdminApiProxy(
    HttpClient httpClient,
    OpenIddictClientService openIddict,
    IHttpContextAccessor httpContextAccessor,
    IConfiguration configuration,
    ILogger<AdminApiProxy> logger)
{
    private const string ProviderName = "pandaauth";

    // issuer 从配置读取而非构造注入 Uri——typed client 由 DI 激活，Uri 类型不可解析
    //（2026-09-19 生产实测：每个代理端点请求 500「Unable to resolve service for type 'System.Uri'」，
    //  单元测试手工 new 构造因此未暴露；WAF 集成测试现覆盖 GET /admin/api/users 钉住激活路径）。
    private Uri PlatformIssuer { get; } = new(configuration["Auth:Issuer"] ?? "http://localhost:9004/");

    public async Task<IResult> ForwardAsync(
        string pathWithQuery,
        HttpMethod method,
        string? jsonBody = null,
        CancellationToken cancellationToken = default)
    {
        var context = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("AdminApiProxy 只能在请求上下文内使用。");

        var tokens = await ReadSessionTokensAsync(context);
        if (tokens.AccessToken is null)
        {
            // 会话里没有 AT（理论不该发生：登录回调都会 StoreTokens）——按未认证处理。
            return Results.Unauthorized();
        }

        try
        {
            using var first = await SendAsync(httpClient, pathWithQuery, method, jsonBody, tokens.AccessToken, context, cancellationToken);
            if (first.StatusCode == HttpStatusCode.Unauthorized)
            {
                logger.LogInformation("Admin API 返回 401，尝试刷新令牌后重试（path={Path}）。", pathWithQuery);
                var refreshed = await TryRefreshAsync(context, tokens, cancellationToken);
                if (refreshed is null)
                {
                    // 刷新失败：会话中的令牌已彻底失效（被吊销/IDP 侧登出），让前端走重新登录。
                    return Results.Unauthorized();
                }

                using var second = await SendAsync(httpClient, pathWithQuery, method, jsonBody, refreshed, context, cancellationToken);
                return await ToResultAsync(second, cancellationToken);
            }

            return await ToResultAsync(first, cancellationToken);
        }
        catch (HttpRequestException exception)
        {
            // IDP 内部地址不可达（宕机/网络）：与上游错误区分开，运维一眼可辨。
            logger.LogError(exception, "Admin API 上游不可达（path={Path}）。", pathWithQuery);
            return Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: "IDP 不可达",
                detail: "管理数据服务暂时不可用，请稍后重试。");
        }
    }

    private static async Task<(string? AccessToken, string? RefreshToken)> ReadSessionTokensAsync(HttpContext context)
        => SessionTokens.Read(await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme));

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient httpClient,
        string pathWithQuery,
        HttpMethod method,
        string? jsonBody,
        string accessToken,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, pathWithQuery);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);

        // 把 BFF 已还原的真实客户端 IP 转给 IDP（见类注释）。
        if (context.Connection.RemoteIpAddress is { } ip)
        {
            request.Headers.TryAddWithoutValidation("X-Forwarded-For", ip.ToString());
        }

        if (jsonBody is not null)
        {
            request.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        }

        return await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
    }

    /// <summary>
    /// 刷新会话令牌：换新 AT/RT 并重写会话 Cookie，**保留既有已门禁的会话身份**。
    /// 失败（无 RT / IDP 拒绝）返回 null。
    /// </summary>
    private async Task<string?> TryRefreshAsync(
        HttpContext context,
        (string? AccessToken, string? RefreshToken) current,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(current.RefreshToken))
        {
            // 会话票据没有 RT：多半是很早版本登录签发的旧会话。记 warning 而非静默——
            // 这是「数据请求 401 → 重登」链路里最隐蔽的一环。
            logger.LogWarning("会话票据中没有 refresh_token，无法刷新（旧版会话？重新登录即自愈）。");
            return null;
        }

        try
        {
            var result = await openIddict.AuthenticateWithRefreshTokenAsync(new OpenIddictClientModels.RefreshTokenAuthenticationRequest
            {
                Issuer = TenantOidcRouting.ResolveIssuer(context.Request, PlatformIssuer),
                ProviderName = ProviderName,
                RefreshToken = current.RefreshToken,
                CancellationToken = cancellationToken,
            });

            // 沿用既有会话身份、只更新令牌——刻意**不**用刷新 principal 重建身份：
            // 刷新流不经过 userinfo 并入，principal 不带 roles claim（IDP 把角色只写入 AT），
            // 若据此重建，角色门禁必然误杀并把在线管理员踢回登录——「进入子页面后
            // 跳回概览」一类问题的根因即在此。角色回收由令牌侧兜底：冻结/重置已联动
            // RevokeUserTokens，令牌失效即会话失效。
            var identity = new ClaimsIdentity(context.User.Identity!);
            var properties = new AuthenticationProperties();
            var tokens = new List<AuthenticationToken>();
            if (result.AccessToken is { } accessToken)
            {
                tokens.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = accessToken });
            }

            if (result.RefreshToken is { } refreshToken)
            {
                tokens.Add(new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = refreshToken });
            }

            if (tokens.Count > 0)
            {
                properties.StoreTokens(tokens);
            }

            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);
            return result.AccessToken;
        }
        catch (Exception exception)
        {
            // 刷新失败不外抛：代理层把它折算成未认证，前端跳登录。
            logger.LogWarning(exception, "会话令牌刷新失败（不影响请求方收到 401）。");
            return null;
        }
    }

    private static async Task<IResult> ToResultAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/json";
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        // 403 语义二分：上游 MFA 门禁（server 侧 Forbid）与真正的权限拒绝在状态码上不可分，
        // 前端把任意 403 当 step-up 会把权限拒绝误导向 /account/mfa。以响应体里的 MFA 标记
        // 字段（ProblemDetails 的 mfaRequired 扩展，camelCase/snake_case 均认）判定，命中才
        // 附加 X-Panda-Mfa-Required: true 供前端精确跳转；裸 403 维持普通透传，走错误展示。
        var mfaRequired = response.StatusCode == HttpStatusCode.Forbidden && MarksMfaRequired(body);
        return new UpstreamResult((int)response.StatusCode, contentType, body, mfaRequired);
    }

    /// <summary>上游响应体是否带 MFA 门禁标记（顶层或 ProblemDetails extensions 下的布尔真值）。</summary>
    /// <remarks>
    /// 刻意容忍两种命名（camelCase 是 MVC ProblemDetails 序列化惯例，snake_case 是协议层惯例）：
    /// server 侧尚未统一契约，此处只认**布尔真**——字符串/数字不算，避免「字段存在即命中」的误判。
    /// 解析失败（空体/HTML——server 侧 Forbid() 即空体 403）一律按无标记处理。
    /// </remarks>
    private static bool MarksMfaRequired(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && (IsTrue(root, "mfaRequired")
                    || IsTrue(root, "mfa_required")
                    || (root.TryGetProperty("extensions", out var extensions)
                        && extensions.ValueKind == JsonValueKind.Object
                        && (IsTrue(extensions, "mfaRequired") || IsTrue(extensions, "mfa_required"))));
        }
        catch (JsonException)
        {
            return false;
        }

        static bool IsTrue(JsonElement element, string name)
            => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
    }

    /// <summary>上游透传结果：除可选的 MFA 标记响应头外不改动任何内容（Results.Content 不支持自定义头）。</summary>
    private sealed class UpstreamResult(int statusCode, string contentType, string body, bool mfaRequired) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            httpContext.Response.StatusCode = statusCode;
            httpContext.Response.ContentType = contentType;
            if (mfaRequired)
            {
                httpContext.Response.Headers["X-Panda-Mfa-Required"] = "true";
            }

            await httpContext.Response.WriteAsync(body, httpContext.RequestAborted);
        }
    }
}
