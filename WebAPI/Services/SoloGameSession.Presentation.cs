using System.Collections.Concurrent;
using FunGame.Core.Entity;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Library.Constant;

namespace FunGame.Testing.WebAPI.Services;

public sealed partial class SoloGameSession
{
    private readonly ConcurrentQueue<Action> _checkpointCommands = new();
    private readonly AutoResetEvent _checkpointWake = new(false);
    private bool _drainingCheckpointCommands;
    private bool OnGameThread => _thread?.ManagedThreadId == Environment.CurrentManagedThreadId;
    private long _stateRevision;
    private long _eventCursor;
    private long _sentEventCursor;
    private long _logCaptured;
    private bool _needsBaseline = true;
    private bool _baselineDelivered;
    private readonly List<PresentationEventDto> _waitingEvents = [];
    private readonly List<string> _waitingLogs = [];
    private readonly List<PresentationLogBindingDto> _waitingBindings = [];
    private List<PresentationEventDto>? _openPresentationAttack;
    private long _actionIdentity;
    private readonly Dictionary<Guid, PendingPresentationCast> _pendingPresentationCasts = [];
    private readonly HashSet<string> _sentDecisionIds = [];
    private readonly HashSet<string> _initialDecisionIds = [];
    private StatePublicationDto? _pendingPublication;
    private volatile GameStateDto? _latestCheckpointSnapshot;

    private void InvokeCheckpoint(Action command)
    {
        if (OnGameThread) { command(); return; }
        if (_thread?.IsAlive != true) throw new InvalidOperationException("Game thread is not running.");
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _checkpointCommands.Enqueue(() =>
        {
            if (completion.Task.IsCompleted) return;
            try { command(); completion.TrySetResult(); }
            catch (Exception exception) { completion.TrySetException(exception); }
        });
        _checkpointWake.Set();
        try { completion.Task.WaitAsync(TimeSpan.FromSeconds(10), _cts.Token).GetAwaiter().GetResult(); }
        catch
        {
            completion.TrySetCanceled(); // 未执行的超时命令不能在以后偷偷改变对局。
            throw;
        }
    }

    private void DrainCheckpointCommands()
    {
        if (!OnGameThread || _drainingCheckpointCommands) return;
        _drainingCheckpointCommands = true;
        try
        {
            while (_checkpointCommands.TryDequeue(out var command)) command();
        }
        finally { _drainingCheckpointCommands = false; }
    }

    private void ResetPendingForBaseline()
    {
        if (_pendingPublication is not null)
            _waitingLogs.InsertRange(0, _pendingPublication.Log);
        _pendingPublication = null;
        _needsBaseline = true;
        _baselineDelivered = false;
        _waitingEvents.Clear();
        _waitingBindings.Clear();
        if (_waitingLogs.Count > 1024) _waitingLogs.RemoveRange(0, _waitingLogs.Count - 1024);
    }

    /// <summary>
    /// 游戏线程检查点：采集日志与事件，再捕获不可变 DTO；发送失败保留原发布身份。
    /// A/B：现有动作钩子与按动作推进的日志；HP／生命周期使用快照差分，不声明完整覆盖。
    /// </summary>
    private bool PublishCheckpoint(bool forceBaseline = false)
    {
        if (!OnGameThread) throw new InvalidOperationException("Snapshot must be captured on the game thread.");
        if (_openPresentationAttack is not null) return false;
        CapturePresentationLogs();
        if (forceBaseline || _waitingEvents.Select(e => e.TimelineId).Distinct().Count() > 64
            || _waitingEvents.Count > 1024 || _waitingLogs.Count > 1024)
            ResetPendingForBaseline();

        // 重传必须保留原状态版本、事件序号、日志和快照；成功才取下一个检查点。
        if (_pendingPublication is not null)
        {
            if (!TrySendPublication(_pendingPublication)) return false;
            _pendingPublication = null;
        }

        var state = CaptureSnapshot() with { StateRevision = ++_stateRevision,
            PendingCasts = CapturePresentationCasts(), PresentationStep = _presentationWaitStep };
        var baseline = _needsBaseline;
        var batch = new PresentationBatchDto(1, baseline ? "baseline" : "events",
            baseline ? _eventCursor : _sentEventCursor, _eventCursor, [],
            baseline ? [] : [.. _waitingEvents],
            baseline ? [] : [.. _waitingBindings]);
        _pendingPublication = new(state, [.. _waitingLogs], batch);
        _waitingEvents.Clear();
        _waitingLogs.Clear();
        _waitingBindings.Clear();
        _latestCheckpointSnapshot = state;
        if (!TrySendPublication(_pendingPublication)) return false;
        _pendingPublication = null;
        SendUndeliveredDecisions();
        return true;
    }

    private bool TrySendPublication(StatePublicationDto publication)
    {
        var sink = _sink;
        if (sink is null) return false;
        try
        {
            sink.SendAsync(SoloMessageTypes.GamingState, publication, _cts.Token).GetAwaiter().GetResult();
            _sentEventCursor = publication.Presentation.EventCursor;
            if (publication.Presentation.Mode == "baseline")
            {
                _needsBaseline = false;
                _baselineDelivered = true;
            }
            return true;
        }
        catch (Exception)
        {
            // 不把发送失败追加成战斗日志，避免重试风暴制造无限日志／事件。
            return false;
        }
    }

    private void SendUndeliveredDecisions()
    {
        if (!_baselineDelivered || _pendingPublication is not null || _sink is null || _presentationWaitStep is not null) return;
        foreach (var (requestId, request) in _pendingRequests)
        {
            if (_sentDecisionIds.Contains(requestId) || !_pending.TryGetValue(requestId, out var pending)
                || pending.Task.IsCompleted) continue;
            try
            {
                object message = _initialDecisionIds.Contains(requestId)
                    ? new { requestId, kind = request.Kind, payload = request.Payload, timeoutMs = (int)DecisionTimeout.TotalMilliseconds }
                    : new { requestId, kind = request.Kind, payload = request.Payload };
                _sink.SendAsync(SoloMessageTypes.GamingRequest, message, _cts.Token).GetAwaiter().GetResult();
                _sentDecisionIds.Add(requestId);
                _initialDecisionIds.Remove(requestId);
            }
            catch { return; }
        }
    }

    private void CapturePresentationLogs(PresentationEventDto? marker = null)
    {
        lock (_logLock)
        {
            if (_logCaptured < _logBaseCursor) ResetPendingForBaseline();
            foreach (var line in _log.Skip((int)Math.Max(0, _logCaptured - _logBaseCursor)))
            {
                var seq = marker?.EventSeq ?? ++_eventCursor;
                if (marker is null)
                    _waitingEvents.Add(new(seq, $"system-log-{seq}", $"log-{seq}", "log.reveal", null, null, 0, new { }));
                _waitingBindings.Add(new(_waitingLogs.Count, seq));
                _waitingLogs.Add(line);
            }
            _logCaptured = _logBaseCursor + _log.Count;
        }
    }

    private void OnPresentationNormalAttack(NormalAttackContext ctx)
    {
        if (_openPresentationAttack is not null)
        { AbandonPresentationAttack(); return; }
        var actor = ctx.Trigger;
        if (actor is null || _queue is null || _map is null || ctx.Targets.Count == 0) return;
        var known = _queue.AllCharacters.Concat(_queue.HardnessTime.Keys).Select(c => c.Guid).ToHashSet();
        if (!known.Contains(actor.Guid) || ctx.Targets.Any(t => !known.Contains(t.Guid)))
        { ResetPendingForBaseline(); return; }
        var originGrid = _map.GetCharacterCurrentGrid(actor);
        var targetGrids = ctx.Targets.Select(t => (Target: t, Grid: _map.GetCharacterCurrentGrid(t))).ToArray();
        if (originGrid is null || targetGrids.Any(t => t.Grid is null)) { ResetPendingForBaseline(); return; }
        CapturePresentationLogs();
        var actionId = $"{Id}-action-{++_actionIdentity}";
        var timelineId = $"{actionId}-main";
        var origin = new PresentationPositionDto(originGrid.Id, originGrid.X, originGrid.Y, originGrid.Z);
        var aimGrid = targetGrids[0].Grid!;
        var aim = new PresentationPositionDto(aimGrid.Id, aimGrid.X, aimGrid.Y, aimGrid.Z);
        var targetGuid = ctx.Targets[0].Guid.ToString();
        _openPresentationAttack = [
            new(0, actionId, timelineId, "action.begin", actor.Guid.ToString(), targetGuid, 0,
                new { actionKind = "attack", skillId = System.Text.Json.JsonSerializer.SerializeToElement<long?>(null),
                    presentationKey = "normal_attack", origin, aim }),
            new(0, actionId, timelineId, "action.release", actor.Guid.ToString(), targetGuid, 260, new { origin, aim })];
        if (actor.ATR > 1)
            foreach (var (target, grid) in targetGrids)
                _openPresentationAttack.Add(new(0, actionId, timelineId, "projectile.spawn", actor.Guid.ToString(), target.Guid.ToString(), 260,
                    new { projectileId = $"{actionId}-{target.Guid}", presentationKey = actor.Id == 2 ? "xinyin_normal" : "generic_ranged",
                        socketKey = "release_hand", origin, destination = new PresentationPositionDto(grid!.Id, grid.X, grid.Y, grid.Z), travelMs = 180 }));
    }

    private void CompletePresentationAttack()
    {
        if (_openPresentationAttack is not { Count: > 0 } draft) return;
        foreach (var entry in draft)
            _waitingEvents.Add(entry with { EventSeq = ++_eventCursor });
        var header = draft[0];
        var castBegin = header.Kind == "cast.begin";
        var marker = new PresentationEventDto(++_eventCursor, header.ActionId, header.TimelineId,
            "log.reveal", header.ActorGuid, null, castBegin ? 0 : 440, new { });
        _waitingEvents.Add(marker);
        CapturePresentationLogs(marker); // 日志随所属动作推进，不解析文本或伪造逐次结算时点。
        if (!castBegin)
            _waitingEvents.Add(new(++_eventCursor, header.ActionId, header.TimelineId, "action.end", header.ActorGuid,
                header.TargetGuid, 790, new { status = "completed" }));
        _openPresentationAttack = null;
    }

    private void OnPresentationCastInterrupted(SkillCastContext ctx)
    {
        // Existing Core notification also covers target loss. Clear the visual only;
        // a later real release starts a new action instead of claiming registry precision.
        if (ctx.Trigger is not { } actor || ctx.Skill is null
            || !_pendingPresentationCasts.TryGetValue(actor.Guid, out var pending)
            || !ReferenceEquals(pending.Skill, ctx.Skill)) return;
        _pendingPresentationCasts.Remove(actor.Guid);
        _waitingEvents.Add(new(++_eventCursor, pending.ActionId, $"{pending.ActionId}-cancel", "cast.cancel",
            actor.Guid.ToString(), null, 0, new { skillId = pending.Skill.Id, reason = "interruption_notification" }));
    }

    private void OnPresentationPreCast(SkillCastContext ctx)
    {
        if (ctx.Trigger?.CharacterState != CharacterState.Casting || ctx.Skill is null) return;
        if (!TryPresentationAim(ctx, out var origin, out var aim)) return;
        CapturePresentationLogs();
        var actionId = $"{Id}-action-{++_actionIdentity}";
        _pendingPresentationCasts[ctx.Trigger.Guid] = new(ctx.Trigger, ctx.Skill, actionId);
        _openPresentationAttack = [new(0, actionId, $"{actionId}-cast", "cast.begin", ctx.Trigger.Guid.ToString(),
            ctx.Targets.FirstOrDefault()?.Guid.ToString(), 0,
            new { skillId = ctx.Skill.Id, presentationKey = "generic_cast", origin, aim })];
    }

    private void OnPresentationSkillRelease(SkillCastContext ctx)
    {
        if (ctx.Skill is null || ctx.Trigger is null || !TryPresentationAim(ctx, out var origin, out var aim)) return;
        if (_openPresentationAttack is not null)
        { AbandonPresentationAttack(); return; } // 嵌套动作在此增量中基线回退，不冒充完整时间线。
        var actionId = $"{Id}-action-{++_actionIdentity}";
        // Other skills / items from the same actor do not complete an unrelated pending magic.
        if (ctx.Item is null && _pendingPresentationCasts.TryGetValue(ctx.Trigger.Guid, out var pending)
            && ReferenceEquals(pending.Skill, ctx.Skill))
        {
            _pendingPresentationCasts.Remove(ctx.Trigger.Guid);
            actionId = pending.ActionId;
            _waitingEvents.Add(new(++_eventCursor, actionId, $"{actionId}-complete", "cast.complete",
                ctx.Trigger.Guid.ToString(), null, 0, new { skillId = ctx.Skill.Id, reason = "released" }));
        }
        var target = ctx.Targets.FirstOrDefault()?.Guid.ToString();
        _openPresentationAttack = [
            new(0, actionId, $"{actionId}-release", "action.begin", ctx.Trigger.Guid.ToString(), target, 0,
                new { actionKind = ctx.Item is null ? "skill" : "item", skillId = ctx.Skill.Id,
                    presentationKey = "generic_skill", origin, aim }),
            new(0, actionId, $"{actionId}-release", "action.release", ctx.Trigger.Guid.ToString(), target, 260, new { origin, aim })];
        // 技能不凭射程推造弹道；专用映射未配置时只用通用释放提示。
    }

    private bool TryPresentationAim(SkillCastContext ctx, out PresentationPositionDto origin, out PresentationPositionDto aim)
    {
        origin = aim = new(0, 0, 0, 0);
        if (_queue is null || _map is null || ctx.Trigger is null) return false;
        var known = _queue.AllCharacters.Concat(_queue.HardnessTime.Keys).Select(c => c.Guid).ToHashSet();
        if (!known.Contains(ctx.Trigger.Guid) || ctx.Targets.Any(t => !known.Contains(t.Guid)))
        { ResetPendingForBaseline(); return false; }
        var grid = _map.GetCharacterCurrentGrid(ctx.Trigger);
        if (grid is null) { ResetPendingForBaseline(); return false; }
        var aimGrid = ctx.Grids.FirstOrDefault() ?? (ctx.Targets.FirstOrDefault() is { } target
            ? _map.GetCharacterCurrentGrid(target) : null) ?? grid;
        origin = new(grid.Id, grid.X, grid.Y, grid.Z);
        aim = new(aimGrid.Id, aimGrid.X, aimGrid.Y, aimGrid.Z);
        return true;
    }

    private void SweepPresentationCasts(bool force = false)
    {
        if (_queue is null) return;
        foreach (var pending in _pendingPresentationCasts.Values.ToArray())
        {
            if (!force && pending.Actor.CharacterState == CharacterState.Casting) continue;
            _pendingPresentationCasts.Remove(pending.Actor.Guid);
            _waitingEvents.Add(new(++_eventCursor, pending.ActionId, $"{pending.ActionId}-cancel", "cast.cancel",
                pending.Actor.Guid.ToString(), null, 0, new { skillId = pending.Skill.Id, reason = force ? "game_over" : "casting_removed" }));
        }
    }

    private PendingCastDto[] CapturePresentationCasts() => _queue is null ? [] : _pendingPresentationCasts.Values
        .Where(p => !Finished && p.Actor.CharacterState == CharacterState.Casting)
        .Select(p => new PendingCastDto(p.Actor.Guid.ToString(), p.ActionId, p.Skill.Id, p.Skill.Name)).ToArray();

    private sealed record PendingPresentationCast(Character Actor, Skill Skill, string ActionId);

    private void AbandonPresentationAttack()
    {
        if (_openPresentationAttack is null) return;
        _openPresentationAttack = null;
        ResetPendingForBaseline();
    }

    private void RetryCheckpointDelivery()
    {
        if (_pendingPublication is not null)
        {
            if (!TrySendPublication(_pendingPublication)) return;
            _pendingPublication = null;
        }
        SendUndeliveredDecisions();
    }
}

public sealed record PresentationPositionDto(long GridId, int X, int Y, int Z);
public sealed record PendingCastDto(string ActorGuid, string ActionId, long SkillId, string SkillName);
public sealed record PresentationEventDto(long EventSeq, string ActionId, string TimelineId, string Kind,
    string? ActorGuid, string? TargetGuid, int OffsetMs, object Data);
public sealed record PresentationLogBindingDto(int LogIndex, long EventSeq);
public sealed record PresentationBatchDto(int Version, string Mode, long FromEventSeq, long EventCursor,
    string[] Coverage, PresentationEventDto[] Events, PresentationLogBindingDto[] LogBindings);
public sealed record StatePublicationDto(GameStateDto State, string[] Log, PresentationBatchDto Presentation);
