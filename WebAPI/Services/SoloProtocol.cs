using System.Text.Json.Serialization;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>
/// 消息类型注册表：与 FunGame.Server-v3 的 MessageTypes 保持一致（小写点分），
/// 单人模式额外扩展 state / log / request 三类，便于将来切到 Server-v3 联机时只替换传输层。
/// </summary>
public static class SoloMessageTypes
{
    // ===== 与 Server-v3 对齐 =====
    public const string Ping = "system.ping";
    public const string Pong = "system.pong";
    public const string Notice = "system.notice";

    public const string GamingStart = "gaming.start";
    public const string GamingAction = "gaming.action";
    public const string GamingEnd = "gaming.end";
    public const string GamingOver = "gaming.over";
    public const string GamingRound = "gaming.round";
    public const string GamingQueue = "gaming.queue";

    // ===== 单人模式扩展 =====
    /// <summary>服务器主动下发的对局状态快照（含增量日志）</summary>
    public const string GamingState = "gaming.state";
    /// <summary>服务器请求玩家做出决策（携带 requestId，客户端用 gaming.action 回传）</summary>
    public const string GamingRequest = "gaming.request";
    /// <summary>已解决决策（广播，用于多端同步）</summary>
    public const string GamingResolved = "gaming.resolved";
    /// <summary>重连后显式接管仍在运行的对局（替代「新连接无条件挂载旧会话」的旧行为）</summary>
    public const string GamingResume = "gaming.resume";
}

/// <summary>错误体</summary>
public sealed record SoloError(string Code, string Message);

/// <summary>消息信封（字段名为单字母，与 Server-v3 MessageEnvelope 一致）</summary>
public sealed class SoloEnvelope
{
    [JsonPropertyName("t")] public string T { get; set; } = "";
    [JsonPropertyName("i")] public int I { get; set; }
    [JsonPropertyName("ok")] public bool O { get; set; } = true;
    [JsonPropertyName("d")] public object? D { get; set; }
    [JsonPropertyName("ts")] public long Ts { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    [JsonPropertyName("error")] public SoloError? Error { get; set; }

    public static SoloEnvelope Ok(string t, int i, object? d = null) => new() { T = t, I = i, O = true, D = d };

    public static SoloEnvelope Fail(string t, int i, string code, string message) =>
        new() { T = t, I = i, O = false, D = null, Error = new SoloError(code, message) };
}

/// <summary>
/// 对局事件出口抽象：单人模式由 WebSocket 实现，联机模式替换为 Server-v3 的会话广播即可。
/// </summary>
public interface IGameEventSink
{
    Task SendAsync(string type, object data, CancellationToken ct);
}

/// <summary>玩家决策种类（对应 gaming.request 的 kind）</summary>
public static class DecisionKind
{
    public const string SelectCharacter = "SelectCharacter";
    public const string ActionType = "ActionType";
    public const string Skill = "Skill";
    public const string Item = "Item";
    public const string Targets = "Targets";
    public const string TargetGrid = "TargetGrid";
    public const string TargetGrids = "TargetGrids";
    public const string Inquiry = "Inquiry";
    public const string Continue = "Continue";
}
