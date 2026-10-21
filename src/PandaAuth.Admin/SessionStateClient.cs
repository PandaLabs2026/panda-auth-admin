using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using PandaAuth.Shared;

namespace PandaAuth.Admin;

public interface IAdminSessionState
{
    Task<bool> IsRevokedAsync(string sessionId, CancellationToken cancellationToken);
    Task RevokeAsync(string sessionId, CancellationToken cancellationToken);
    Task<bool> IsLoginRevokedAsync(string sessionId, CancellationToken cancellationToken);
    Task RevokeLoginAsync(string sessionId, CancellationToken cancellationToken);
}

public sealed class SessionStateClient(HttpClient http, IConfiguration configuration) : IAdminSessionState
{
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private string? _token;
    private DateTimeOffset _tokenExpiry;

    public async Task<bool> IsRevokedAsync(string sessionId, CancellationToken cancellationToken)
    {
        using var request = await CreateRequestAsync(PandaAuthSessionApi.Check, new SessionStateCheckRequest(sessionId), cancellationToken);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<SessionStateCheckResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Session-state check returned an empty response.");
        return result.Revoked;
    }

    public async Task RevokeAsync(string sessionId, CancellationToken cancellationToken)
    {
        using var request = await CreateRequestAsync(PandaAuthSessionApi.Revoke, new SessionStateRevokeRequest(sessionId), cancellationToken);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task<bool> IsLoginRevokedAsync(string sessionId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParseExact(sessionId, "N", out _)) throw new ArgumentException("Invalid login session identifier.", nameof(sessionId));
        using var request = await CreateRequestAsync(PandaAuthSessionApi.SsoCheck, new SessionStateCheckRequest(sessionId), cancellationToken);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SessionStateCheckResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Shared session-state check returned an empty response.")).Revoked;
    }

    public async Task RevokeLoginAsync(string sessionId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParseExact(sessionId, "N", out _)) throw new ArgumentException("Invalid login session identifier.", nameof(sessionId));
        using var request = await CreateRequestAsync(PandaAuthSessionApi.SsoRevoke, new SessionStateRevokeRequest(sessionId), cancellationToken);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task<HttpRequestMessage> CreateRequestAsync<T>(string path, T body, CancellationToken cancellationToken)
    {
        var token = await GetTokenAsync(cancellationToken);
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true };
        return request;
    }

    private async Task<string> GetTokenAsync(CancellationToken cancellationToken)
    {
        if (_token is not null && _tokenExpiry > DateTimeOffset.UtcNow.AddSeconds(30)) return _token;
        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_token is not null && _tokenExpiry > DateTimeOffset.UtcNow.AddSeconds(30)) return _token;
            var secret = configuration["Auth:SessionState:ClientSecret"];
            if (string.IsNullOrWhiteSpace(secret)) throw new InvalidOperationException("Auth:SessionState:ClientSecret is required.");
            using var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = PandaAuthSessionApi.AdminClientId,
                ["client_secret"] = secret,
                ["scope"] = PandaAuthSessionApi.Scope,
            });
            using var response = await http.PostAsync(PandaAuthEndpoints.Token, form, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var payload = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            _token = payload.RootElement.GetProperty("access_token").GetString()
                ?? throw new InvalidOperationException("Session-state token response omitted access_token.");
            var seconds = payload.RootElement.TryGetProperty("expires_in", out var expires) ? expires.GetInt32() : 60;
            _tokenExpiry = DateTimeOffset.UtcNow.AddSeconds(Math.Max(1, seconds));
            return _token;
        }
        finally { _tokenLock.Release(); }
    }
}
