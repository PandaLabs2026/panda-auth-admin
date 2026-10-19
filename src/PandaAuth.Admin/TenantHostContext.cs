using System.Security.Claims;
using PandaAuth.Shared;

namespace PandaAuth.Admin;

/// <summary>校验 PandaAuth Admin 当前请求主机与会话中的租户声明是否一致。</summary>
/// <remarks>
/// 规范租户主机是 t####-auth.sNNN.pandalabs.cn；旧的 t####.auth.pandalabs.cn 已退役。
/// 平台/遗留主机（如 fleet 的 auth.appliket.com、localhost）没有租户语义，直接放行；
/// 只有能被共享解析器识别为规范租户主机时才要求 claims 与主机一致。
/// 总开关 Auth:TenantRouting:Enabled 默认 false，与服务端保持同一发布节奏。
/// </remarks>
public static class TenantHostContext
{
    public static bool TryValidate(
        HttpContext context, ClaimsPrincipal principal, out string? reason, bool enabled = true)
    {
        reason = null;
        if (!enabled) return true;

        var host = context.Request.Host.Host;
        if (IsLocalHost(host)) return true;

        // 非规范主机（平台域/遗留域/内网别名）没有租户语义，放行；规范主机必须自证。
        if (!TenantCanonicalHost.TryParse(host, out var tenantId, out var product, out _) ||
            product != TenantProduct.PandaAuth)
        {
            return true;
        }

        var claimTenant = principal.FindFirstValue(PandaAuthClaims.TenantId);
        var claimHost = principal.FindFirstValue(PandaAuthClaims.TenantHost);
        if (!string.Equals(claimTenant, tenantId.Value, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(claimHost, host.TrimEnd('.'), StringComparison.OrdinalIgnoreCase))
        {
            reason = TenantContextErrors.ContextMismatch;
            return false;
        }

        return true;
    }

    public static bool IsLocalHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("[::1]", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);
}

/// <summary>已登录请求的租户主机边界；总开关关闭时保持既有单租户行为。</summary>
public sealed class TenantHostContextMiddleware(RequestDelegate next, IConfiguration configuration)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (IsAnonymousEntry(context.Request.Path) ||
            context.User.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        if (configuration.GetValue<bool>("Auth:TenantRouting:Enabled") &&
            !TenantHostContext.TryValidate(context, context.User, out var reason, enabled: true))
        {
            context.Response.StatusCode = reason == TenantContextErrors.UnknownHost
                ? StatusCodes.Status421MisdirectedRequest
                : StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }

    private static bool IsAnonymousEntry(PathString path) =>
        path.StartsWithSegments("/admin/login") ||
        path.StartsWithSegments("/admin/challenge") ||
        path.StartsWithSegments("/admin/callback/login");
}
