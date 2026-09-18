namespace PandaAuth.WebAdmin;

/// <summary>登出撤销（<see cref="TokenRevocationClient"/>）的 DI 装配。</summary>
public static class TokenRevocationServiceCollectionExtensions
{
    /// <summary>
    /// 注册登出撤销客户端；撤销超时在**启动期**读取并校验，非法即拒绝启动。
    /// </summary>
    /// <remarks>
    /// <para>
    /// 校验必须留在启动期，不能只依赖 <c>AddHttpClient</c> 的 configure 委托：
    /// 该委托**在宿主机启动时不执行**，只在解析 <see cref="TokenRevocationClient"/> 时才跑。
    /// 非法超时（<c>0</c> / 负数 → <c>HttpClient.Timeout</c> 抛 <see cref="ArgumentOutOfRangeException"/>）
    /// 于是会推迟到 <c>/admin/api/logout</c> 的端点参数绑定阶段爆发——那已在防伪校验与
    /// <c>SignOutAsync</c> **之前**，后果是登出 100% 返回 500、Cookie 永不清除、RP 的
    /// end-session 永不发出（用户看到的是「点登出没反应」），而不是一次可诊断的启动失败。
    /// 移植自 panda-auth-me 的同名扩展（启动期实测行为见 me 仓注释）。
    /// </para>
    /// <para>
    /// 顺带消掉「配置热重载（<c>reloadOnChange</c>）在运行期把取值改坏」踩同一个坑：
    /// 取值只在此处读一次，运行期不再复读。
    /// </para>
    /// </remarks>
    public static IServiceCollection AddTokenRevocation(
        this IServiceCollection services,
        IConfiguration configuration,
        TokenRevocationOptions options)
    {
        var timeoutSeconds = configuration.GetValue("Auth:RevocationTimeoutSeconds", 5);
        if (timeoutSeconds <= 0)
        {
            throw new InvalidOperationException(
                $"Auth:RevocationTimeoutSeconds 必须为正数，当前取值：{timeoutSeconds}（登出撤销请求的超时秒数）。");
        }

        services.AddHttpClient<TokenRevocationClient>(client =>
        {
            // 这是**两次串行请求**（refresh_token、access_token）各自的超时，
            // 故 IDP 被黑洞时登出最坏阻塞时间约为该值的 2 倍。
            // 之所以要收紧：撤销是登出请求路径上的同步动作，沿用 HttpClient 默认的
            // 100 秒会让用户点一次登出干等 100 秒（最坏 200 秒）。
            client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
        });
        services.AddSingleton(options);

        return services;
    }
}
