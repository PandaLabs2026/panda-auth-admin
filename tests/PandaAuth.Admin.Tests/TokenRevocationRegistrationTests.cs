using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// 撤销客户端的 DI 装配测试：走容器解析，而不是手工 <c>new</c>
///（随四件套自 panda-auth-me 移植，端点路径换为 /admin/api/logout）。
/// </summary>
/// <remarks>
/// <para>
/// 存在的理由：其余用例都手工 <c>new TokenRevocationClient(...)</c>，**没有一条经过容器**——
/// 而「配置取值非法」恰恰只在容器解析时才爆发。<c>AddHttpClient</c> 的 configure 委托
/// 在宿主机启动时不执行，只在解析 <see cref="TokenRevocationClient"/> 时执行，
/// 于是非法超时会推迟到 <c>/admin/api/logout</c> 的参数绑定阶段（防伪校验与 SignOutAsync 之前）
/// → 登出 100% 500、Cookie 永不清除。
/// </para>
/// <para>
/// 装配走的是生产代码 <see cref="TokenRevocationServiceCollectionExtensions.AddTokenRevocation"/>
/// （Program.cs 调用的同一个方法），不是在本文件里重抄一遍注册，因此校验挪走或挪错位置
/// 都会在这里红灯。
/// </para>
/// </remarks>
public class TokenRevocationRegistrationTests
{
    private static IConfiguration Configuration(string? timeoutSeconds) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:RevocationTimeoutSeconds"] = timeoutSeconds,
            })
            .Build();

    private static TokenRevocationOptions Options() =>
        new(new Uri("http://localhost:9004/"), "admin-web", "unit-test-secret");

    [Theory]
    // 显式配置与缺省（不配该键 → 默认 5）都必须能装配出来。
    [InlineData("5")]
    [InlineData(null)]
    [InlineData("1")]
    public void AddTokenRevocation_ResolvesClientFromContainer(string? timeoutSeconds)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTokenRevocation(Configuration(timeoutSeconds), Options());

        using var provider = services.BuildServiceProvider();

        // 解析成功 = DI 装配可用。真实 app 里这一步就在 /admin/api/logout 的参数绑定阶段，
        // 解析失败即登出 500（且发生在清 Cookie 之前）。
        var client = provider.GetRequiredService<TokenRevocationClient>();
        Assert.NotNull(client);
        // 每次解析都是新的轻量客户端（HttpClient 由工厂管理，不重复建连接池）。
        Assert.NotNull(provider.GetRequiredService<TokenRevocationClient>());
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    public void AddTokenRevocation_NonPositiveTimeout_FailsAtStartup(string timeoutSeconds)
    {
        var services = new ServiceCollection();
        services.AddLogging();

        var exception = Assert.Throws<InvalidOperationException>(
            () => services.AddTokenRevocation(Configuration(timeoutSeconds), Options()));

        // 报错必须能诊断到配置键与取值——配置错误要在启动期一眼可读，
        // 而不是变成运行期一次没有上下文的 500。
        Assert.Contains("Auth:RevocationTimeoutSeconds", exception.Message);
        Assert.Contains(
            $"当前取值：{int.Parse(timeoutSeconds, CultureInfo.InvariantCulture)}",
            exception.Message);
    }
}
