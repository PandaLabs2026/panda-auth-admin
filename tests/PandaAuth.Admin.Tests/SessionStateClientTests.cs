using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using PandaAuth.Admin;
using Xunit;

namespace PandaAuth.Admin.Tests;

public class SessionStateClientTests
{
    [Fact]
    public async Task CheckAndRevoke_UseDedicatedClientAndCacheOnlyAccessToken()
    {
        var calls = new List<(string Path, string? Body, string? Authorization)>();
        var handler = new StubHandler(async request =>
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync();
            calls.Add((request.RequestUri!.AbsolutePath, body, request.Headers.Authorization?.ToString()));
            return request.RequestUri.AbsolutePath == "/connect/token"
                ? Json("{\"access_token\":\"m2m\",\"expires_in\":300}")
                : Json("{\"revoked\":false}");
        });
        var client = Create(handler);

        Assert.False(await client.IsRevokedAsync("sid-1", default));
        await client.RevokeAsync("sid-1", default);
        Assert.False(await client.IsRevokedAsync("sid-1", default));

        Assert.Equal(1, calls.Count(call => call.Path == "/connect/token"));
        Assert.Contains("client_id=admin-session-api", calls.Single(call => call.Path == "/connect/token").Body);
        Assert.Equal(2, calls.Count(call => call.Path == "/session-state/v1/check"));
        Assert.Equal(1, calls.Count(call => call.Path == "/session-state/v1/revoke"));
        Assert.All(calls.Where(call => call.Path != "/connect/token"), call => Assert.Equal("Bearer m2m", call.Authorization));
        Assert.Contains("sid-1", calls.Single(call => call.Path == "/session-state/v1/revoke").Body);
    }

    [Fact]
    public async Task Check_WhenServerUnavailable_ThrowsForFailClosedCaller()
    {
        var client = Create(new StubHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable))));
        await Assert.ThrowsAsync<HttpRequestException>(() => client.IsRevokedAsync("sid-1", default));
    }

    [Fact]
    public async Task LocalTimeoutAndExplicitSharedLogout_UseSeparateRevocationBoundaries()
    {
        var paths = new List<string>();
        var client = Create(new StubHandler(request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            paths.Add(path);
            return Task.FromResult(path == "/connect/token" ? Json("{\"access_token\":\"fixture\",\"expires_in\":300}") : Json("{}"));
        }));
        const string sid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        await client.RevokeAsync(sid, default);
        Assert.DoesNotContain(PandaAuth.Shared.PandaAuthSessionApi.SsoRevoke, paths);
        await client.RevokeLoginAsync(sid, default);
        Assert.Contains(PandaAuth.Shared.PandaAuthSessionApi.SsoRevoke, paths);
    }
    private static SessionStateClient Create(HttpMessageHandler handler)
    {
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://server/") };
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:SessionState:ClientSecret"] = "test-secret",
        }).Build();
        return new SessionStateClient(http, config);
    }

    private static HttpResponseMessage Json(string value) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(value, Encoding.UTF8, "application/json"),
    };

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
