using PandaAuth.Shared;

namespace PandaAuth.Admin;

public static class TenantOidcRouting
{
    public static Uri ResolveIssuer(HttpRequest request, Uri platformIssuer)
    {
        var host = request.Host.Host;
        if (!TenantCanonicalHost.TryParse(host, out _, out var product, out _) ||
            product != TenantProduct.PandaAuth)
        {
            return platformIssuer;
        }

        // 规范租户主机：issuer 与主机同源。尾点归一，避免与 IDP 的 issuer 完全匹配失败。
        return new Uri($"{request.Scheme}://{host.TrimEnd('.')}/");
    }
}
