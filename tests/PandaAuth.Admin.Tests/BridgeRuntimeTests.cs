using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;
namespace PandaAuth.Admin.Tests;

public sealed class BridgeRuntimeTests
{
    private sealed class PeerFilter(string peer) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, pipeline) =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
                context.Request.Scheme = "http";
                return pipeline(context);
            });
            next(app);
        };
    }

    [Theory]
    [InlineData("100.64.3.1", true)]
    [InlineData("100.64.3.2", false)]
    [InlineData("127.0.0.1", false)]
    public async Task ProductionBridge_AntiforgeryRequiresExactGateway(string peer, bool trusted)
    {
        var directory = Path.Combine(Path.GetTempPath(), "panda-admin-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("Auth:ClientSecret", "fixture-secret");
                builder.UseSetting("Auth:Issuer", "https://idp.example.invalid/");
                builder.UseSetting("Auth:IdpInternalBaseAddress", "http://127.0.0.1:6000/");
                builder.UseSetting("Auth:DataProtectionKeyPath", directory);
                builder.UseSetting("PANDA_AUTH_TENANT_NETWORK_MODE", "bridge");
                builder.UseSetting("PANDA_AUTH_TRUSTED_PROXY", "100.64.3.1");
                builder.ConfigureServices(services => services.AddSingleton<IStartupFilter>(new PeerFilter(peer)));
            });
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false });
            var options = factory.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;
            Assert.Equal(new[] { IPAddress.Parse("100.64.3.1") }, options.KnownProxies);
            Assert.Empty(options.KnownIPNetworks);
            using var request = new HttpRequestMessage(HttpMethod.Get, "/admin/api/antiforgery");
            request.Headers.Add("X-Forwarded-Proto", "https");
            request.Headers.Add("X-Forwarded-For", "203.0.113.9");
            using var response = await client.SendAsync(request);
            Assert.Equal(trusted ? HttpStatusCode.OK : HttpStatusCode.InternalServerError, response.StatusCode);
            if (trusted) Assert.Contains(response.Headers.GetValues("Set-Cookie"), cookie =>
                cookie.Contains("Antiforgery", StringComparison.Ordinal) && cookie.Contains("secure", StringComparison.OrdinalIgnoreCase));
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
