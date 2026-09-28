using PandaAuth.Shared;

namespace PandaAuth.Admin;

public static class TenantOidcRouting
{
    public static Uri ResolveIssuer(HttpRequest request, Uri platformIssuer)
    {
        var host = request.Host.Host;
        if (!TenantHostContext.LooksLikeTenantHost(host))
            return platformIssuer;

        var suffix = ".auth.pandalabs.cn";
        var prefix = host[..^suffix.Length];
        TenantId.Parse(prefix);
        return new Uri($"{request.Scheme}://{host}/");
    }
}
