using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Admin.Tests;

public sealed class PermissionMatrixRuntimeTests
{
    [Theory]
    [InlineData(null, "/admin/api/session", HttpStatusCode.Unauthorized)]
    [InlineData(null, "/admin/api/users", HttpStatusCode.Unauthorized)]
    [InlineData("", "/admin/api/session", HttpStatusCode.Forbidden)]
    [InlineData("user", "/admin/api/session", HttpStatusCode.Forbidden)]
    [InlineData("", "/admin/api/users", HttpStatusCode.Forbidden)]
    [InlineData("user", "/admin/api/users", HttpStatusCode.Forbidden)]
    [InlineData("admin", "/admin/api/session", HttpStatusCode.OK)]
    public async Task AdminRoutes_EnforceRolesBeyondTheLoginCallback(string? role, string path, HttpStatusCode expected)
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "fixture-secret");
            builder.ConfigureServices(services =>
            {
                services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, FixtureIdentity>("PermissionFixture", _ => { });
                services.PostConfigure<AuthenticationOptions>(options =>
                {
                    options.DefaultAuthenticateScheme = "PermissionFixture";
                    options.DefaultChallengeScheme = "PermissionFixture";
                    options.DefaultForbidScheme = "PermissionFixture";
                });
            });
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (role is not null) client.DefaultRequestHeaders.Add("X-Fixture-Role", role.Length == 0 ? "missing" : role);
        using var response = await client.GetAsync(path);
        Assert.Equal(expected, response.StatusCode);
    }

    private sealed class FixtureIdentity(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Fixture-Role", out var role)) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new("sub", "fixture-user") };
            if (role != "missing") claims.Add(new Claim("role", role.ToString()));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(
                new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name, "name", "role")), Scheme.Name)));
        }
        protected override Task HandleChallengeAsync(AuthenticationProperties properties) { Response.StatusCode = 401; return Task.CompletedTask; }
        protected override Task HandleForbiddenAsync(AuthenticationProperties properties) { Response.StatusCode = 403; return Task.CompletedTask; }
    }
}
