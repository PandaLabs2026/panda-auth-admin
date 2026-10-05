using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.IdentityModel.Tokens;

namespace PandaAuth.Admin;

/// <summary>
/// OpenIddict 客户端加密/签名密钥的持久化存取：在 DataProtection 密钥目录内
/// load-or-create <c>client-keys.json</c>。
/// </summary>
/// <remarks>
/// <para>为什么必须持久化：登录挑战发出的 state（以及往返的授权上下文令牌）由客户端
/// 自身的加密+签名密钥保护，<c>AddEphemeralEncryptionKey/AddEphemeralSigningKey</c>
/// 每次重启重新生成——进程一重启，全部在途登录的 state 作废，用户被无声打回登录入口
/// 重走授权。密钥落盘后重启不再丢在途登录。</para>
/// <para>目录复用 <c>Auth:DataProtectionKeyPath</c>：该卷的访问边界、备份策略与
/// DataProtection 密钥环完全一致，同为「攻陷即等于攻陷全部会话」级别的机密，
/// 没有理由分两处保护。文件损坏时失败关闭（抛异常拒绝启动）而不是静默重新生成：
/// 静默轮换等于把故障伪装成「所有人被登出」，排障时无从察觉。</para>
/// <para>单实例前提：并发进程同时首次启动时 load-or-create 存在竞窗（后写覆盖先写），
/// admin BFF 为单容器部署（compose 现状），多实例需改为原子创建或外置密钥服务。</para>
/// </remarks>
public static class ClientKeys
{
    private const string FileName = "client-keys.json";

    /// <summary>加载持久化密钥；文件不存在则生成并写入，随后返回新建材料。</summary>
    public static (EncryptingCredentials Encryption, SigningCredentials Signing) LoadOrCreate(string directory)
    {
        var path = Path.Combine(directory, FileName);
        if (File.Exists(path))
        {
            return Read(path);
        }

        // 对称加密密钥 256 位（A256KW + A256CBC-HS512 的要求）；签名 RSA-2048/RS256——
        // 与 AddEphemeral* 的算法族一致，令牌格式不因持久化而变。
        var encryption = new EncryptingCredentials(
            new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)),
            SecurityAlgorithms.Aes256KW,
            SecurityAlgorithms.Aes256CbcHmacSha512);

        using var rsa = RSA.Create(keySizeInBits: 2048);
        var parameters = rsa.ExportParameters(includePrivateParameters: true);
        var signing = new SigningCredentials(new RsaSecurityKey(parameters), SecurityAlgorithms.RsaSha256);

        var document = new KeyDocument(
            Version: 1,
            Encryption: new EncryptionMaterial(Algorithm: SecurityAlgorithms.Aes256KW,
                EncryptionAlgorithm: SecurityAlgorithms.Aes256CbcHmacSha512,
                Key: Base64UrlEncoder.Encode(((SymmetricSecurityKey)encryption.Key).Key)),
            Signing: ToMaterial(SecurityAlgorithms.RsaSha256, parameters));
        File.WriteAllText(path, JsonSerializer.Serialize(document, JsonOptions));
        return (encryption, signing);
    }

    private static (EncryptingCredentials Encryption, SigningCredentials Signing) Read(string path)
    {
        KeyDocument document;
        try
        {
            document = JsonSerializer.Deserialize<KeyDocument>(File.ReadAllText(path), JsonOptions)
                ?? throw new InvalidOperationException("文件内容为空。");
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            throw new InvalidOperationException(
                $"OpenIddict 客户端密钥文件不可读：{path}（损坏的密钥文件不得静默轮换，请人工排查卷状态后删除重建。）",
                exception);
        }

        if (document.Encryption is not { Key.Length: > 0 }
            || document.Signing is not { Modulus.Length: > 0, Exponent.Length: > 0, D.Length: > 0 })
        {
            throw new InvalidOperationException($"OpenIddict 客户端密钥文件字段缺失：{path}");
        }

        var encryption = new EncryptingCredentials(
            new SymmetricSecurityKey(Base64UrlEncoder.DecodeBytes(document.Encryption.Key)),
            document.Encryption.Algorithm is { Length: > 0 } alg ? alg : SecurityAlgorithms.Aes256KW,
            document.Encryption.EncryptionAlgorithm is { Length: > 0 } enc ? enc : SecurityAlgorithms.Aes256CbcHmacSha512);

        var signing = new SigningCredentials(
            new RsaSecurityKey(FromMaterial(document.Signing)),
            document.Signing.Algorithm is { Length: > 0 } sig ? sig : SecurityAlgorithms.RsaSha256);
        return (encryption, signing);
    }

    private static SigningMaterial ToMaterial(string algorithm, RSAParameters parameters) => new(
        Algorithm: algorithm,
        Modulus: Base64UrlEncoder.Encode(parameters.Modulus),
        Exponent: Base64UrlEncoder.Encode(parameters.Exponent),
        D: Base64UrlEncoder.Encode(parameters.D),
        P: parameters.P is null ? null : Base64UrlEncoder.Encode(parameters.P),
        Q: parameters.Q is null ? null : Base64UrlEncoder.Encode(parameters.Q),
        DP: parameters.DP is null ? null : Base64UrlEncoder.Encode(parameters.DP),
        DQ: parameters.DQ is null ? null : Base64UrlEncoder.Encode(parameters.DQ),
        InverseQ: parameters.InverseQ is null ? null : Base64UrlEncoder.Encode(parameters.InverseQ));

    private static RSAParameters FromMaterial(SigningMaterial material) => new()
    {
        Modulus = Base64UrlEncoder.DecodeBytes(material.Modulus),
        Exponent = Base64UrlEncoder.DecodeBytes(material.Exponent),
        D = Base64UrlEncoder.DecodeBytes(material.D),
        P = material.P is null ? null : Base64UrlEncoder.DecodeBytes(material.P),
        Q = material.Q is null ? null : Base64UrlEncoder.DecodeBytes(material.Q),
        DP = material.DP is null ? null : Base64UrlEncoder.DecodeBytes(material.DP),
        DQ = material.DQ is null ? null : Base64UrlEncoder.DecodeBytes(material.DQ),
        InverseQ = material.InverseQ is null ? null : Base64UrlEncoder.DecodeBytes(material.InverseQ),
    };

    private static JsonSerializerOptions JsonOptions => new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private sealed record KeyDocument(int Version, EncryptionMaterial? Encryption, SigningMaterial? Signing);

    private sealed record EncryptionMaterial(string Algorithm, string EncryptionAlgorithm, string Key);

    private sealed record SigningMaterial(
        string Algorithm,
        string Modulus,
        string Exponent,
        string D,
        string? P,
        string? Q,
        string? DP,
        string? DQ,
        string? InverseQ);
}
