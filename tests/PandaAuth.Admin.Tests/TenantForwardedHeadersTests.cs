using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using PandaAuth.Admin.Infrastructure.Security;
using Xunit;

namespace PandaAuth.Admin.Tests;

public sealed class TenantForwardedHeadersTests
{
    private static readonly IPAddress Gateway = IPAddress.Parse("100.64.3.1");
    private static readonly IPAddress Client = IPAddress.Parse("203.0.113.9");

    [Fact]
    public async Task BridgeMode_ConsumesForwardedHeadersOnlyFromExactGateway()
    {
        var options = CreateOptions(Gateway.ToString());
        var context = CreateContext(Gateway, Client.ToString());
        await InvokeAsync(context, options);
        Assert.Equal(Client, context.Connection.RemoteIpAddress);
        Assert.Equal("https", context.Request.Scheme);
        Assert.Equal(new[] { Gateway }, options.KnownProxies);
    }

    [Theory]
    [InlineData("100.64.3.2")]
    [InlineData("127.0.0.1")]
    public async Task BridgeMode_IgnoresForwardedHeadersFromOtherPeers(string peerValue)
    {
        var peer = IPAddress.Parse(peerValue);
        var context = CreateContext(peer, "1.2.3.4");
        await InvokeAsync(context, CreateOptions(Gateway.ToString()));
        Assert.Equal(peer, context.Connection.RemoteIpAddress);
        Assert.Equal("http", context.Request.Scheme);
    }

    [Fact]
    public void BridgeMode_RejectsMissingOrNonIpProxy()
    {
        Assert.Throws<InvalidOperationException>(() => CreateOptions(null));
        Assert.Throws<InvalidOperationException>(() => CreateOptions("100.64.3.0/24"));
    }

    private static ForwardedHeadersOptions CreateOptions(string? gateway)
    {
        var values = new Dictionary<string, string?>
        {
            ["PANDA_AUTH_TENANT_NETWORK_MODE"] = "bridge",
        };
        if (gateway is not null) values["PANDA_AUTH_TRUSTED_PROXY"] = gateway;
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = 1,
        };
        TenantForwardedHeaders.Configure(options, configuration);
        return options;
    }

    private static DefaultHttpContext CreateContext(IPAddress peer, string forwardedFor)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = peer;
        context.Request.Scheme = "http";
        context.Request.Headers["X-Forwarded-For"] = forwardedFor;
        context.Request.Headers["X-Forwarded-Proto"] = "https";
        return context;
    }

    private static Task InvokeAsync(HttpContext context, ForwardedHeadersOptions options)
    {
        var middleware = new ForwardedHeadersMiddleware(
            static _ => Task.CompletedTask,
            NullLoggerFactory.Instance,
            Options.Create(options));
        return middleware.Invoke(context);
    }
}
