namespace PandaAuth.Admin;

/// <summary>
/// <c>/admin/login</c> 的 <c>returnUrl</c> 校验：只放行**本地、且落在 <c>/admin</c> 前缀下**的相对路径。
/// </summary>
/// <remarks>
/// <para>
/// 存在的理由：<c>returnUrl</c> 是查询串里的用户输入，登录成功后会成为 <c>RedirectUri</c>。
/// 原样采用即构成**开放重定向**——攻击者投递 <c>/admin/login?returnUrl=https://evil.com</c>，
/// 受害者看到的是 PandaAuth 自己的登录页、地址栏也确实是 panda-auth 域名，登录后却落到外站，
/// 钓鱼链接因此具备了「可信域名 + 真实登录流程」的外观。这里做的是**白名单**而非黑名单：
/// 只承认 <c>/admin</c> 前缀，其余一律回退 <see cref="Fallback"/>。
/// </para>
/// <para>
/// 被拒绝的形态及理由：
/// <list type="bullet">
///   <item>绝对 URL（<c>https://evil.com</c>）——直接外站。</item>
///   <item>协议相对（<c>//evil.com</c>）——浏览器按当前 scheme 解析为 <c>https://evil.com</c>，
///   与绝对 URL 等价；单纯「以 <c>/</c> 开头」不足以判定本地。</item>
///   <item>反斜杠（<c>/\evil.com</c>，以及路径中途的 <c>\</c>）——WHATWG URL 解析把 <c>\</c> 视同 <c>/</c>，
///   故 <c>/\evil.com</c> 与 <c>//evil.com</c> 同义。一律拒绝含 <c>\</c> 的输入，
///   免得逐个推导「这段反斜杠会不会在归一化后拼出 <c>//</c>」。</item>
///   <item>非 <c>/admin</c> 前缀的本地路径（<c>/evil</c>）——本函数只服务于 admin 服务，
///   放行其它前缀没有正当用途。</item>
///   <item><c>..</c> 路径段（<c>/admin/..//evil.com</c>）——它本身还不是外站跳转，但归并 <c>..</c> 之后
///   路径会变成 <c>//evil.com</c>，即**归一化后才成形的协议相对地址**。一个合法回跳不需要 <c>..</c>，
///   因此直接拒掉，换来一条不依赖「谁在什么时候做归一化」的不变式。</item>
/// </list>
/// </para>
/// <para>
/// 返回值是**原始字符串**，不拼接、不做 Uri 归一化。配合上面几条拒绝规则，函数的不变式是：
/// 返回值或是 <see cref="Fallback"/>，或是「以单个 <c>/</c> 开头、无 <c>\</c>、无 <c>..</c> 段、
/// 且落在 <c>/admin</c> 前缀下」的路径。这样一个路径在**按相对引用解析**时宿主机不会变。
/// </para>
/// <para>
/// **不变式的依赖（消费方须知）**：上面这条结论依赖消费方把它当**相对引用**（relative reference）
/// 来解析——即浏览器对 <c>Location</c> 的处理，此时百分号编码不会被提前解码
/// （<c>/admin/%2F%2Fevil.com</c> 的路径段就是字面量 <c>%2F%2Fevil.com</c>，仍是本机路径）。
/// 若将来把返回值交给一个会**先解码、再按绝对 URL 重新解析**的消费点，同一条输入解码一次后
/// 就变成 <c>/admin///evil.com</c> 乃至 <c>//evil.com</c>，本函数的判断（基于未解码的原串）即失去保护。
/// 本函数不为下游的解码行为兜底：它保证的是「字符串本身是一个本机相对路径」，
/// 不是「任何消费方解码后仍是本机路径」。当前唯一消费点是
/// <c>AuthenticationProperties.RedirectUri</c>，走的是相对引用语义，故当前不可利用——
/// 新增消费点时必须沿用同一语义。
/// </para>
/// <para>移植自 panda-auth-me 的同名类型（含测试矩阵），仅前缀不同；修改规则时两仓同步。</para>
/// </remarks>
public static class LoginReturnUrl
{
    /// <summary>缺省与所有校验失败的落点：管理后台首页。</summary>
    public const string Fallback = "/admin/";

    /// <summary>
    /// 校验 <c>returnUrl</c>；不合法（含空值）时返回 <see cref="Fallback"/>。
    /// </summary>
    public static string Sanitize(string? returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl))
        {
            return Fallback;
        }

        // 反斜杠先行拦截：它可能在 URL 解析阶段被当作 /，是「看着是相对路径、实际是协议相对」的来源。
        if (returnUrl.Contains('\\'))
        {
            return Fallback;
        }

        // 只承认 /admin/ 前缀（以及 /admin 本身）：以 /admin 之外的任何字符起头都回退，
        // 于是绝对 URL、协议相对、javascript: 等形态在这一个判断里全部出局。
        if (!returnUrl.StartsWith("/admin/", StringComparison.Ordinal) &&
            !string.Equals(returnUrl, "/admin", StringComparison.Ordinal))
        {
            return Fallback;
        }

        // .. 段：归并后可能拼出 //（协议相对）。合法回跳用不到，直接拒。
        foreach (var segment in returnUrl.Split('/'))
        {
            if (segment == "..")
            {
                return Fallback;
            }
        }

        return returnUrl;
    }
}
