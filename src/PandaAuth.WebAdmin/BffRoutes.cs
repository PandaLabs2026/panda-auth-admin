namespace PandaAuth.WebAdmin;

/// <summary>
/// BFF 保留的路径前缀：这些命名空间属于**服务端接口**，不属于前端路由。
/// </summary>
/// <remarks>
/// <para>
/// 维护约定：Phase 1 新增服务端命名空间（例如 <c>/admin/v2</c>）时，把前缀加进
/// <see cref="ProtectedPrefixes"/> 即可——Program.cs 会为每个前缀自动注册一条受保护的回退兜底，
/// 不必记得去那里手写一行 MapFallback。
/// </para>
/// <para>
/// 漏加的后果不是「少个功能」而是**默认拒绝静默失效**：该命名空间下未映射的路径会被匿名的
/// SPA 回退接走，返回 200 + index.html，于是既探不到 401，也分不清「路径拼错」与
/// 「端点漏加授权」。这正是 2026-09-16 在 <c>/admin/api</c> 上实测到并修掉的缺陷
/// （<c>/admin/api/session</c>、<c>/admin/api/users</c> 当时均为 200）。
/// **兜底是按前缀专有的**，所以新增命名空间时这里必须同步——集中成常量就是为了让这一步可见。
/// </para>
/// </remarks>
public static class BffRoutes
{
    /// <summary>
    /// 受保护前缀：其下未映射的路径返回 404，匿名调用方先在授权阶段被拦下。
    /// </summary>
    public static readonly string[] ProtectedPrefixes = ["/admin/api"];
}
