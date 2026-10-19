using Microsoft.AspNetCore.Http;
using PandaAuth.Admin;
using Xunit;

namespace PandaAuth.Admin.Tests;

public class SecurityHeadersMiddlewareTests
{
    [Fact]
    public async Task ApiResponse_IsNoStoreAndHttpsGetsHsts()
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/admin/api/session";
        context.Request.Scheme = "https";
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(context);

        Assert.Equal("no-store", context.Response.Headers.CacheControl);
        Assert.Equal("max-age=31536000", context.Response.Headers.StrictTransportSecurity);
    }
}
