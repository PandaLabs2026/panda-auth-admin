using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Admin.Tests;

public sealed class SessionStatusValidationTests
{
    [Theory]
    [InlineData(HttpStatusCode.OK, HttpStatusCode.OK)]
    [InlineData(HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.ServiceUnavailable, HttpStatusCode.ServiceUnavailable)]
    public async Task SessionStatus_ValidatesIssuedTokensBeforeReportingAuthenticated(HttpStatusCode upstream, HttpStatusCode expected)
    {
        var calls = 0;
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "fixture-secret");
            builder.UseSetting("Auth:Issuer", "https://idp.example.invalid/");
            builder.UseSetting("Auth:IdpInternalBaseAddress", "https://idp.example.invalid/");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IAdminSessionState>();
                services.AddSingleton<IAdminSessionState, ActiveSessionState>();
                services.RemoveAll<IAdminSessionRefresher>();
                services.AddSingleton<IAdminSessionRefresher, RejectedRefresh>();
                services.AddHttpClient<AdminApiProxy>().ConfigurePrimaryHttpMessageHandler(() => new UserinfoHandler(upstream, () => calls++));
            });
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false });
        var properties = new AuthenticationProperties { IssuedUtc = DateTimeOffset.UtcNow, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) };
        properties.Items[SessionTokens.AdminResourceProperty] = PandaAuthAdminApi.Scope;
        properties.StoreTokens([
            new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = "fixture-access" },
            new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = "fixture-refresh" },
        ]);
        var identity = new ClaimsIdentity([
            new Claim("sub", "fixture-user"), new Claim("role", "admin"),
            new Claim(AdminSessionLifecycle.SessionIdClaimType, Guid.NewGuid().ToString("N")),
            new Claim(AdminSessionLifecycle.StartedAtClaimType, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
            new Claim(PandaAuthClaims.SsoSessionId, Guid.NewGuid().ToString("N")),
        ], "Cookies", "name", "role");
        var cookie = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get("Cookies");
        client.DefaultRequestHeaders.Add("Cookie", cookie.Cookie.Name + "=" + cookie.TicketDataFormat.Protect(new AuthenticationTicket(new ClaimsPrincipal(identity), properties, "Cookies")));
        using var response = await client.GetAsync("/admin/api/session");
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(1, calls);
        Assert.Null(response.Headers.Location);
        if (upstream == HttpStatusCode.OK)
        {
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("fixture-user", payload.GetProperty("subject").GetString());
            Assert.Contains(payload.GetProperty("roles").EnumerateArray(), role => role.GetString() == "admin");
        }
        if (upstream == HttpStatusCode.Unauthorized)
            Assert.Contains(response.Headers.GetValues("Set-Cookie"), value => value.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase));
        else if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.DoesNotContain(cookies, value => value.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class UserinfoHandler(HttpStatusCode status, Action called) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal(PandaAuthEndpoints.Userinfo, request.RequestUri!.AbsolutePath);
            Assert.Equal("fixture-access", request.Headers.Authorization?.Parameter);
            called();
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent("{}", Encoding.UTF8, "application/json") });
        }
    }
    private sealed class RejectedRefresh : IAdminSessionRefresher
    {
        public Task<RefreshedTokens> RefreshAsync(Microsoft.AspNetCore.Http.HttpContext context, string refreshToken, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Synthetic invalid_grant");
    }
    private sealed class ActiveSessionState : IAdminSessionState
    {
        public Task<bool> IsRevokedAsync(string sessionId, CancellationToken cancellationToken) => Task.FromResult(false);
        public Task<bool> IsLoginRevokedAsync(string sessionId, CancellationToken cancellationToken) => Task.FromResult(false);
        public Task RevokeAsync(string sessionId, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task RevokeLoginAsync(string sessionId, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
