using PandaAuth.Shared;

namespace PandaAuth.Admin;

public static class TenantOidcRouting
{
    public static Uri ResolveIssuer(HttpRequest request, Uri platformIssuer)
    {
        var host = request.Host.Host;
        if (!TenantHostContext.LooksLikeTenantHost(host))
            return platformIssuer;

        // 后缀常量与主机判定同源（TenantHostContext）：两处各写一份字面量迟早漂移。
        var prefix = host[..^TenantHostContext.TenantHostSuffix.Length];
        TenantId.Parse(prefix);
        return new Uri($"{request.Scheme}://{host}/");
    }
}
