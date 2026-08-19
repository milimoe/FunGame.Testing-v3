using System.Text;
using System.Text.Json;
using FunGame.Core.Api;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.Tests;

// usage: CheckpointSizeMeasure <label> [team|mix]
//        CheckpointSizeMeasure analyze <zipPath> <label>
if (args.Length < 1)
{
    Console.WriteLine("usage: CheckpointSizeMeasure <label> [team|mix]");
    Console.WriteLine("       CheckpointSizeMeasure analyze <zipPath> <label>");
    return 1;
}

if (args[0] == "analyze")
{
    string analyzeZip = args.Length > 1 ? args[1] : throw new Exception("missing zip path");
    string label = args.Length > 2 ? args[2] : "analyze";
    if (!File.Exists(analyzeZip))
    {
        Console.WriteLine($"[{label}] ERROR: file not found {analyzeZip}");
        return 2;
    }
    Dictionary<int, RoundRecord>? analyzeRounds = FunGameSimulation.ReadRoundsFromZip(analyzeZip);
    if (analyzeRounds == null || analyzeRounds.Count == 0)
    {
        Console.WriteLine($"[{label}] ERROR: failed to load rounds");
        return 2;
    }
    Report(label, analyzeRounds, analyzeZip, false);
    StripAnalysis(label, analyzeRounds);
    ZipComparison(label, analyzeRounds, analyzeZip);
    return 0;
}

string label0 = args[0];
bool isTeam = args.Length < 2 || args[1] == "team";

FunGameService.InitFunGame();
FunGameSimulation.IsDebug = true;
FunGameSimulation.PrintOut = false;

Console.WriteLine($"[{label0}] starting {(isTeam ? "team" : "mix")} simulation...");
DateTime sw = DateTime.Now;
List<string> messages = await FunGameSimulation.StartSimulationGame(false, false, isTeam, false, hasMap: false);
Console.WriteLine($"[{label0}] simulation done in {(DateTime.Now - sw).TotalSeconds:F1}s, messages={messages.Count}");

string zipPath = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "rounds_archive.zip"));
if (!File.Exists(zipPath))
{
    Console.WriteLine($"[{label0}] ERROR: no rounds_archive.zip at {zipPath}");
    return 2;
}
Dictionary<int, RoundRecord>? rounds = FunGameSimulation.ReadRoundsFromZip(zipPath);
if (rounds == null || rounds.Count == 0)
{
    Console.WriteLine($"[{label0}] ERROR: failed to load rounds");
    return 2;
}
Report(label0, rounds, zipPath, isTeam);
return 0;

/// <summary>
/// 受控对比：把同一份数据分别按「含 Description / Description 置空」序列化，精确统计 Description 带来的字节增量。
/// 快照序列化中 Skills/Items/Effects 列表是相互独立的，列表级 diff 之和即整个检查点的 Description 开销。
/// </summary>
static void StripAnalysis(string label, Dictionary<int, RoundRecord> rounds)
{
    JsonSerializerOptions indented = JsonTool.JsonSerializerOptions;
    JsonSerializerOptions compact = new(JsonTool.JsonSerializerOptions) { WriteIndented = false };

    long skillsDescInd = 0, itemsDescInd = 0, effectsDescInd = 0;
    long skillsDescCompact = 0, itemsDescCompact = 0, effectsDescCompact = 0;
    int skillEntries = 0, itemEntries = 0, effectEntries = 0;

    foreach (RoundRecord round in rounds.Values)
    {
        if (round.Checkpoint is not { Count: > 0 }) continue;
        foreach (CharacterStateSnapshot state in round.Checkpoint)
        {
            skillEntries += state.Skills.Count;
            itemEntries += state.Items.Count;
            effectEntries += state.Effects.Count;

            skillsDescInd += ListDescBytes(state.Skills, indented);
            skillsDescCompact += ListDescBytes(state.Skills, compact);
            itemsDescInd += ListDescBytes(state.Items, indented);
            itemsDescCompact += ListDescBytes(state.Items, compact);
            effectsDescInd += ListDescBytes(state.Effects, indented);
            effectsDescCompact += ListDescBytes(state.Effects, compact);
        }
    }

    long totalDescInd = skillsDescInd + itemsDescInd + effectsDescInd;
    long totalDescCompact = skillsDescCompact + itemsDescCompact + effectsDescCompact;
    int totalEntries = skillEntries + itemEntries + effectEntries;

    Console.WriteLine($"===== STRIP ANALYSIS {label} =====");
    Console.WriteLine($"entries: skills={skillEntries} items={itemEntries} effects={effectEntries} total={totalEntries}");
    Console.WriteLine($"description bytes (indented):  skills={skillsDescInd} items={itemsDescInd} effects={effectsDescInd} total={totalDescInd} avg/entry={(totalEntries > 0 ? totalDescInd / (double)totalEntries : 0):F1}");
    Console.WriteLine($"description bytes (compact):   skills={skillsDescCompact} items={itemsDescCompact} effects={effectsDescCompact} total={totalDescCompact} avg/entry={(totalEntries > 0 ? totalDescCompact / (double)totalEntries : 0):F1}");
    Console.WriteLine($"per-entry(compact): skills={(skillEntries > 0 ? skillsDescCompact / (double)skillEntries : 0):F1} items={(itemEntries > 0 ? itemsDescCompact / (double)itemEntries : 0):F1} effects={(effectEntries > 0 ? effectsDescCompact / (double)effectEntries : 0):F1}");
    Console.WriteLine($"===== END STRIP ANALYSIS {label} =====");
}

static long ListDescBytes<T>(IEnumerable<T> withDesc, JsonSerializerOptions opts)
{
    long with = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(withDesc, opts));
    long without = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(StripDesc(withDesc), opts));
    return with - without;
}

/// <summary>
/// ZIP 级对比：把同一份数据的 Description 全部置空后重新打包，量出压缩后 ZIP 的真实体积差
/// </summary>
static void ZipComparison(string label, Dictionary<int, RoundRecord> rounds, string originalZipPath)
{
    long originalZip = new FileInfo(originalZipPath).Length;
    foreach (RoundRecord round in rounds.Values)
    {
        if (round.Checkpoint == null) continue;
        foreach (CharacterStateSnapshot state in round.Checkpoint)
        {
            foreach (SkillStateSnapshot s in state.Skills) s.Description = "";
            foreach (ItemStateSnapshot s in state.Items) s.Description = "";
            foreach (EffectStateSnapshot s in state.Effects) s.Description = "";
        }
    }
    string strippedZip = Path.Combine(Path.GetTempPath(), "stripped_" + Guid.NewGuid().ToString("N") + ".zip");
    FunGameSimulation.WriteRoundsToZip(rounds, strippedZip);
    long strippedLen = new FileInfo(strippedZip).Length;
    long delta = originalZip - strippedLen;
    Console.WriteLine($"zip comparison: original={originalZip} stripped={strippedLen} delta={delta} ({(originalZip > 0 ? delta * 100.0 / originalZip : 0):F2}%)");
    try
    {
        File.Delete(strippedZip);
    }
    catch
    {
    }
}

static List<object> StripDesc<T>(IEnumerable<T> items)
{
    List<object> result = [];
    foreach (T item in items)
    {
        switch (item)
        {
            case SkillStateSnapshot s:
                result.Add(new SkillStateSnapshot { SkillId = s.SkillId, SkillName = s.SkillName, Level = s.Level, CurrentCD = s.CurrentCD });
                break;
            case ItemStateSnapshot s:
                result.Add(new ItemStateSnapshot { ItemId = s.ItemId, ItemName = s.ItemName });
                break;
            case EffectStateSnapshot s:
                result.Add(new EffectStateSnapshot { EffectId = s.EffectId, EffectName = s.EffectName, EffectType = s.EffectType, RemainDuration = s.RemainDuration, RemainDurationTurn = s.RemainDurationTurn, SourceGuid = s.SourceGuid });
                break;
            default:
                result.Add(item);
                break;
        }
    }
    return result;
}

static void Report(string label, Dictionary<int, RoundRecord> rounds, string zipPath, bool isTeam)
{
    JsonSerializerOptions indented = JsonTool.JsonSerializerOptions;
    JsonSerializerOptions compact = new(JsonTool.JsonSerializerOptions) { WriteIndented = false };

    // 存档 JSON（缩进格式，与 rounds_data.json 一致）
    string archiveJson = JsonSerializer.Serialize(rounds, indented);
    long archiveJsonBytes = Encoding.UTF8.GetByteCount(archiveJson);
    long entryUncompressed = 0;
    using (FileStream fs = File.OpenRead(zipPath))
    using (System.IO.Compression.ZipArchive za = new(fs, System.IO.Compression.ZipArchiveMode.Read))
    {
        System.IO.Compression.ZipArchiveEntry? entry = za.GetEntry("rounds_data.json");
        if (entry != null) entryUncompressed = entry.Length;
    }
    long zipBytes = new FileInfo(zipPath).Length;

    long checkpointRoundIndented = 0;
    long checkpointPortionIndented = 0;
    long checkpointRoundCompact = 0;
    long checkpointPortionCompact = 0;
    long maxSingleCheckpointRoundCompact = 0;
    long maxSingleCheckpointPortionCompact = 0;
    long allRoundsCompact = 0;
    int checkpointCount = 0;
    int skillEntries = 0, itemEntries = 0, effectEntries = 0;
    long skillEntriesJson = 0, itemEntriesJson = 0, effectEntriesJson = 0;

    foreach (RoundRecord round in rounds.Values)
    {
        string singleJson = JsonSerializer.Serialize(round, compact);
        allRoundsCompact += Encoding.UTF8.GetByteCount(singleJson);
        if (round.Checkpoint is { Count: > 0 })
        {
            checkpointCount++;
            string singleIndented = JsonSerializer.Serialize(round, indented);
            checkpointRoundIndented += Encoding.UTF8.GetByteCount(singleIndented);
            checkpointRoundCompact += Encoding.UTF8.GetByteCount(singleJson);
            long singleBytes = Encoding.UTF8.GetByteCount(singleJson);
            if (singleBytes > maxSingleCheckpointRoundCompact) maxSingleCheckpointRoundCompact = singleBytes;

            string cpJson = JsonSerializer.Serialize(round.Checkpoint, indented);
            checkpointPortionIndented += Encoding.UTF8.GetByteCount(cpJson);
            string cpJsonCompact = JsonSerializer.Serialize(round.Checkpoint, compact);
            long cpBytes = Encoding.UTF8.GetByteCount(cpJsonCompact);
            checkpointPortionCompact += cpBytes;
            if (cpBytes > maxSingleCheckpointPortionCompact) maxSingleCheckpointPortionCompact = cpBytes;

            foreach (CharacterStateSnapshot state in round.Checkpoint)
            {
                skillEntries += state.Skills.Count;
                itemEntries += state.Items.Count;
                effectEntries += state.Effects.Count;
                skillEntriesJson += Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(state.Skills, indented));
                itemEntriesJson += Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(state.Items, indented));
                effectEntriesJson += Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(state.Effects, indented));
            }
        }
    }

    Console.WriteLine($"===== {label} ({(isTeam ? "team" : "mix")}) =====");
    Console.WriteLine($"rounds={rounds.Count} checkpointRounds={checkpointCount}");
    Console.WriteLine($"archiveJson(indented)={archiveJsonBytes} bytes | entryUncompressed={entryUncompressed} | zip={zipBytes} bytes");
    Console.WriteLine($"allRoundsCompact={allRoundsCompact} bytes");
    Console.WriteLine($"checkpointRoundJson: indented={checkpointRoundIndented} compact={checkpointRoundCompact}");
    Console.WriteLine($"checkpointPortionJson: indented={checkpointPortionIndented} compact={checkpointPortionCompact}");
    Console.WriteLine($"maxSingleCheckpointRoundCompact={maxSingleCheckpointRoundCompact} | avgCheckpointRoundCompact={(checkpointCount > 0 ? checkpointRoundCompact / checkpointCount : 0)}");
    Console.WriteLine($"maxSingleCheckpointPortionCompact={maxSingleCheckpointPortionCompact} | avgCheckpointPortionCompact={(checkpointCount > 0 ? checkpointPortionCompact / checkpointCount : 0)}");
    Console.WriteLine($"entries: skills={skillEntries} items={itemEntries} effects={effectEntries} total={skillEntries + itemEntries + effectEntries}");
    Console.WriteLine($"entriesJson(indented): skills={skillEntriesJson} items={itemEntriesJson} effects={effectEntriesJson} total={skillEntriesJson + itemEntriesJson + effectEntriesJson}");
    Console.WriteLine($"===== END {label} =====");
}
