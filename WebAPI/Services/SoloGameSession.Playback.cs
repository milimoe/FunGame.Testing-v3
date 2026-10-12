namespace FunGame.Testing.WebAPI.Services;

public sealed partial class SoloGameSession
{
    private bool _waitForPresentation;
    private long _presentationStepIdentity;
    private long? _presentationWaitStep;

    public void AcknowledgePresentation(string gameId, long step)
    {
        if (!OnGameThread)
        {
            if (_thread?.IsAlive != true) return;
            InvokeCheckpoint(() => AcknowledgePresentation(gameId, step));
            return;
        }
        // Exact current game/step only: duplicate, stale, future and other-game acknowledgements cannot release a newer action.
        if (gameId == Id && _presentationWaitStep == step) _presentationWaitStep = null;
    }

    private void WaitForClientPresentation()
    {
        if (!_waitForPresentation || !PlayerConnected || _sink is null || _cts.IsCancellationRequested
            || _openPresentationAttack is not null) return;
        _presentationWaitStep = ++_presentationStepIdentity;
        FlushState(); // Unthrottled, immutable publication carries the step before any next action/decision.
        var deadline = Environment.TickCount64 + 15000;
        while (_presentationWaitStep is not null && PlayerConnected && !_cts.IsCancellationRequested)
        {
            _checkpointWake.WaitOne(50);
            DrainCheckpointCommands(); // Ack, external pause, disconnect and resume remain responsive.
            RetryCheckpointDelivery();
            if (_presentationWaitStep is { } step && _pendingPublication is null
                && _latestCheckpointSnapshot?.PresentationStep != step)
                PublishCheckpoint(); // An older failed publication may have delayed publishing this gate.
            if (_paused) deadline = Environment.TickCount64 + 15000;
            if (_presentationWaitStep is not null && Environment.TickCount64 >= deadline)
            {
                _presentationWaitStep = null;
                _needsBaseline = true;
                WriteLine("[表现同步] 等待客户端完成超时，按最新状态恢复基线。");
                PublishCheckpoint(forceBaseline: true); // Abandon old pending identities as an explicit barrier.
            }
        }
        _presentationWaitStep = null;
        if (!_cts.IsCancellationRequested) WaitWhilePaused(); // Playback ack must not release a separate user pause.
    }
}
