using System.Security.Claims;
using PandaAuth.Shared;

namespace PandaAuth.Admin;

/// <summary>校验 PandaAuth Admin 当前请求主机与会话中的租户声明是否一致。</summary>
public static class TenantHostContext
{
    private const string PlatformHost = "auth.pandalabs.cn";

    public static bool TryValidate(HttpContext context, ClaimsPrincipal principal, out string? reason)
    {
        var host = context.Request.Host.Host;
        if (string.Equals(host, PlatformHost, StringComparison.OrdinalIgnoreCase))
        {
            reason = null;
            return true;
        }

        // 本地开发和反向代理健康检查可能使用 localhost/内网主机名；它们没有租户语义，
        // 不应被误判成租户入口。生产租户入口必须匹配下面的 t####.auth.pandalabs.cn。
        if (!LooksLikeTenantHost(host))
        {
            reason = null;
            return true;
        }

        if (!TryParseTenantHost(host, out var tenantId))
        {
            reason = TenantContextErrors.UnknownHost;
            return false;
        }

        var claimTenant = principal.FindFirstValue(PandaAuthClaims.TenantId);
        var claimHost = principal.FindFirstValue(PandaAuthClaims.TenantHost);
        if (!string.Equals(claimTenant, tenantId.Value, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(claimHost, host, StringComparison.OrdinalIgnoreCase))
        {
            reason = TenantContextErrors.ContextMismatch;
            return false;
        }

        reason = null;
        return true;
    }

    private static bool TryParseTenantHost(string host, out TenantId tenantId)
    {
        tenantId = default;
        const string suffix = ".auth.pandalabs.cn";
        if (!host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            return false;

        var prefix = host[..^suffix.Length];
        try
        {
            tenantId = TenantId.Parse(prefix);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static bool LooksLikeTenantHost(string host) =>
        host.EndsWith(".auth.pandalabs.cn", StringComparison.OrdinalIgnoreCase) &&
        host.Length > ".auth.pandalabs.cn".Length;
}

/// <summary>已登录请求的租户主机边界；平台主机保留平台管理员兼容行为。</summary>
public sealed class TenantHostContextMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (IsAnonymousEntry(context.Request.Path) ||
            context.User.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        if (TenantHostContext.LooksLikeTenantHost(context.Request.Host.Host) &&
            !TenantHostContext.TryValidate(context, context.User, out var reason))
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
        path.StartsWithSegments("/admin/callback/login");
}
