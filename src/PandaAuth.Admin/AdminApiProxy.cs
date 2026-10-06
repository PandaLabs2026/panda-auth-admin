using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.Admin;

/// <summary>
/// BFF → IDP Admin 数据 API 的代理：转发请求（Bearer AT + 原始客户端 IP 透传），
/// 上游 401 时用 refresh token 换新令牌（重写会话 Cookie）后重试一次。
/// </summary>
/// <remarks>
/// <para>AT 有效期仅 10 分钟而会话 2 小时——刷新不是边角，是常规路径。
/// OpenIddict 的 refresh token 是一次性的：换到的新 AT/RT **必须**随 SignInAsync 回写会话，
/// 否则下一次刷新或登出撤销都会拿着已作废的旧 RT 失败；并发 401 的刷新单飞见
/// <see cref="RefreshGate"/>（同一只 RT 只允许兑换一次，输家复用赢家的新 AT）。</para>
/// <para>X-Forwarded-For 透传：本 BFF 的 ForwardedHeaders 已把 Caddy 传入的真实客户端 IP
/// 还原到 Connection.RemoteIpAddress；再作为 XFF 转给 IDP（IDP 同样只信任回环代理），
/// 管理审计于是记录到真人 IP 而非 127.0.0.1。</para>
/// </remarks>
public sealed class AdminApiProxy(
    HttpClient httpClient,
    IAdminSessionRefresher sessionRefresher,
    IHttpContextAccessor httpContextAccessor,
    ILogger<AdminApiProxy> logger)
{

    /// <summary>
    /// 按 subject 的刷新单飞闸门：串行信号量 + 最近一次成功刷新的输出。
    /// </summary>
    /// <remarks>
    /// <para>为什么必须单飞：AT 仅 10 分钟而会话 2 小时，前端常态并发（users 页的
    /// Promise.all 等）。两个并发 401 各自拿**同一只一次性 RT** 去刷新，输家吃 invalid_grant
    /// 被踢回登录，还可能触发 IDP 的重放检测把整条令牌链吊销。闸门按 subject 分桶：
    /// 不同管理员互不阻塞；条目数以管理员数为上界，进程生命周期内驻留（不回收）。</para>
    /// <para><see cref="LastRefresh"/> 是并发场景的第二通道：在途请求的 Cookie 在发送时已冻结，
    /// 输家重读会话票据看到的仍是旧 RT——只能从这里拿到赢家刚换出的新 AT。读写都在
    /// 信号量临界区内完成，无需额外同步。前提是 admin BFF 单实例部署（compose 现状），
    /// 多实例需要外移到共享存储才能维持同等保证。</para>
    /// </remarks>
    private sealed class RefreshGate
    {
        public SemaphoreSlim Semaphore { get; } = new(1, 1);

        public (string OldRefreshToken, string? NewAccessToken)? LastRefresh { get; set; }
    }

    private static readonly ConcurrentDictionary<string, RefreshGate> RefreshGates = new();

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
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                // 请求方取消（浏览器断开/前端 abort）：原样上抛，交给框架按取消记账——
                // 把「客户端不等了」与「上游故障」区分开，不折算 5xx 污染错误指标。
                throw;
            }

            // IDP 内部地址不可达（宕机/网络）：与上游错误区分开，运维一眼可辨。
            // HttpClient 30s 超时抛的同样是 TaskCanceledException 且不会置调用方 token——
            // 与请求方取消靠上面的 IsCancellationRequested 区分；此前只 catch
            // HttpRequestException，超时漏成裸 500。
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
    /// <remarks>
    /// 单飞两层（见 <see cref="RefreshGate"/> 注释）：进入临界区后先重读会话票据——
    /// RT 已不同于本请求出发时那只，说明他人已刷新并回写 Cookie，直接复用新 AT 重试原请求；
    /// 在途请求的 Cookie 发送时已冻结、重读仍是旧 RT，则比对 <see cref="RefreshGate.LastRefresh"/>：
    /// 本请求持有的旧 RT 恰是上一位赢家刚兑换过的——同样直接复用，不发刷新。
    /// </remarks>
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

        var subject = context.User.FindFirst(Claims.Subject)?.Value ?? string.Empty;
        var gate = RefreshGates.GetOrAdd(subject, static _ => new RefreshGate());

        // WaitAsync 留在 try 之外：取消发生在等锁期间时直接抛出，不得对未持有的信号量 Release。
        await gate.Semaphore.WaitAsync(cancellationToken);
        try
        {
            var session = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            var latest = SessionTokens.Read(session);

            // 层一（票据重读）：请求晚于他人刷新完成到达（浏览器已吃到新 Cookie）时，
            // 票据里已是新 RT——直接复用新 AT，连 IDP 都不必问。
            if (!string.Equals(latest.RefreshToken, current.RefreshToken, StringComparison.Ordinal)
                && latest.AccessToken is { } carried)
            {
                return carried;
            }

            // 层二（赢家结果复用）：并发在途请求的 Cookie 在发送时已冻结，重读票据看不到
            // 他人的回写——但同 subject 的上一位赢家刚兑换过这只 RT，其新 AT 可直接复用。
            // 没有这一层，排队的输家会拿已作废的旧 RT 再刷一次：invalid_grant 是最好结局，
            // 触发 IDP 重放检测则整条令牌链吊销（在线管理员全部被踢回登录）。
            if (gate.LastRefresh is { } outcome
                && string.Equals(outcome.OldRefreshToken, current.RefreshToken, StringComparison.Ordinal)
                && outcome.NewAccessToken is { } inherited)
            {
                return inherited;
            }

            return await RefreshAsync(context, current.RefreshToken, session, gate, cancellationToken);
        }
        finally
        {
            gate.Semaphore.Release();
        }
    }

    /// <summary>
    /// 实际执行刷新并回写会话（调用方必须已持有该 subject 的 <see cref="RefreshGate"/> 信号量，
    /// 且 <paramref name="refreshToken"/> 已在 TryRefreshAsync 入口验过非空）。
    /// </summary>
    private async Task<string?> RefreshAsync(
        HttpContext context,
        string refreshToken,
        AuthenticateResult session,
        RefreshGate gate,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await sessionRefresher.RefreshAsync(context, refreshToken, cancellationToken);

            // 沿用既有会话身份、只更新令牌——刻意**不**用刷新 principal 重建身份：
            // 刷新流不经过 userinfo 并入，principal 不带 roles claim（IDP 把角色只写入 AT），
            // 若据此重建，角色门禁必然误杀并把在线管理员踢回登录——「进入子页面后
            // 跳回概览」一类问题的根因即在此。角色回收由令牌侧兜底：冻结/重置已联动
            // RevokeUserTokens，令牌失效即会话失效。
            var identity = new ClaimsIdentity(context.User.Identity!);

            // 回写必须继承原票据的持久化属性：IsPersistent/ExpiresUtc 若在此重置，
            // 「记住我」语义被悄悄改写，且每次刷新都把 2 小时滑动窗口整个续满——
            // 刷新是 10 分钟 AT 下的常态路径，等于会话永不过期。
            var properties = new AuthenticationProperties
            {
                IsPersistent = session.Properties?.IsPersistent ?? false,
                ExpiresUtc = session.Properties?.ExpiresUtc,
            };
            var tokens = new List<AuthenticationToken>();
            if (result.AccessToken is { } accessToken)
            {
                tokens.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = accessToken });
            }

            if (result.RefreshToken is { } rotatedRefreshToken)
            {
                tokens.Add(new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = rotatedRefreshToken });
            }

            if (tokens.Count > 0)
            {
                properties.StoreTokens(tokens);
            }

            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);

            // 记录本次兑换供并发输家复用（见 RefreshGate.LastRefresh 注释）。
            gate.LastRefresh = (refreshToken, result.AccessToken);
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
