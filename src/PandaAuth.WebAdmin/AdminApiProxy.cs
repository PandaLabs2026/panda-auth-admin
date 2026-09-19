using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using OpenIddict.Client;

namespace PandaAuth.WebAdmin;

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
    private Uri Issuer { get; } = new(configuration["Auth:Issuer"] ?? "http://localhost:9004/");

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
    /// 刷新会话令牌：换新 AT/RT 并重写会话 Cookie（同一身份重建，角色门禁重新判定）。
    /// 成功返回新 AT；失败（无 RT / IDP 拒绝 / 角色丢失）返回 null。
    /// </summary>
    private async Task<string?> TryRefreshAsync(
        HttpContext context,
        (string? AccessToken, string? RefreshToken) current,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(current.RefreshToken))
        {
            return null;
        }

        try
        {
            var result = await openIddict.AuthenticateWithRefreshTokenAsync(new OpenIddictClientModels.RefreshTokenAuthenticationRequest
            {
                Issuer = Issuer,
                ProviderName = ProviderName,
                RefreshToken = current.RefreshToken,
                CancellationToken = cancellationToken,
            });

            // 刷新后的身份重新过一遍门禁（角色被回收的账号不得继续停留管理台）。
            var (identity, isAdmin) = AdminSessionIdentity.Build(result.Principal!);
            if (!isAdmin)
            {
                logger.LogWarning("令牌刷新成功但 admin 角色已丢失，拒绝重建会话。");
                return null;
            }

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
        return Results.Content(body, contentType, statusCode: (int)response.StatusCode);
    }
}
