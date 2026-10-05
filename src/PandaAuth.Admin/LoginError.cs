namespace PandaAuth.Admin;

/// <summary>
/// 登录回调失败的错误码白名单与文案映射。
/// </summary>
/// <remarks>
/// 回调认证失败时把 error 码带回 /admin/login 可见化（否则系统性故障下用户在
/// admin↔IDP 之间打转直到限流 429，全程无提示）。error 码只允许白名单成员进入
/// 查询串、文案完全出自本表：<c>error_description</c> 等 IDP 原文**不**透传——
/// 那是一段未经约束的输入，拼进重定向或页面都是现成的注入面，而固定文案已足够
/// 定位问题。<see cref="StateInvalid"/> 是本服务自造码（本地 state 校验失败的
/// 回调请求没有 error 查询参数可用），命名空间与 OIDC 规范码区分。
/// </remarks>
public static class LoginError
{
    /// <summary>本地 state 校验失败（缺失/不符/已过期/密钥轮换）的自造错误码。</summary>
    public const string StateInvalid = "state_invalid";

    /// <summary>白名单外的错误码统一折算值（未知码不透传，防止任意串进入查询串）。</summary>
    public const string Unknown = "unknown";

    private static readonly Dictionary<string, string> Messages = new()
    {
        // OIDC/OAuth2 规范码（授权端点与令牌端点常见失败）。
        ["access_denied"] = "授权被拒绝：你可能在 IDP 侧取消了授权，或账号无权访问管理后台。",
        ["temporarily_unavailable"] = "IDP 暂时不可用，请稍后重试。",
        ["server_error"] = "IDP 内部错误，请稍后重试；若持续出现请联系管理员。",
        ["invalid_request"] = "登录请求参数异常（配置不匹配或请求被篡改），请联系管理员。",
        ["invalid_scope"] = "登录请求的授权范围不被支持，请联系管理员。",
        ["unauthorized_client"] = "客户端未被授权使用此登录方式，请联系管理员。",
        ["unsupported_response_type"] = "IDP 不支持当前授权类型，请联系管理员。",
        ["invalid_client"] = "客户端凭据校验失败（密钥失效或已轮换），请联系管理员。",
        ["invalid_grant"] = "授权凭据已失效或被重放，请重新登录。",
        ["invalid_token"] = "回调令牌校验失败：登录会话已过期或已失效，请重新登录。",
        ["login_required"] = "IDP 会话已失效，请重新登录。",
        ["interaction_required"] = "IDP 需要额外交互（如重新认证），请重试登录。",
        ["consent_required"] = "IDP 要求重新确认授权，请重试登录。",
        // 本服务自造码。
        [StateInvalid] = "回调状态校验失败：登录会话已过期或已失效，请重新登录。",
        [Unknown] = "登录未完成（未知错误），请重试；若持续出现请联系管理员。",
    };

    /// <summary>是否白名单成员（未知码折算 <see cref="Unknown"/>，不透传原文）。</summary>
    public static string Normalize(string? code)
        => string.IsNullOrEmpty(code) || !Messages.ContainsKey(code) ? Unknown : code;

    /// <summary>构建带回错误码的登录入口重定向地址（仅白名单码，无其他透传参数）。</summary>
    public static string RedirectTarget(string? code)
        => "/admin/login?error=" + Uri.EscapeDataString(Normalize(code));

    /// <summary>错误码对应的人话文案（输入先行白名单化）。</summary>
    public static string Describe(string? code)
        => Messages[Normalize(code)];
}
