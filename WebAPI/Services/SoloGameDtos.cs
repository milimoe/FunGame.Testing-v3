using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;

namespace FunGame.Testing.WebAPI.Services;

// ==================== 快照 DTO（输出时由 ASP.NET Core 自动转 camelCase） ====================

/// <summary>地图格子</summary>
public sealed record GridDto(long Id, int X, int Y, int Z, string Color, List<string> Characters);

/// <summary>地图</summary>
public sealed record MapDto(string Name, int Length, int Width, int Height, float Size, List<GridDto> Grids);

/// <summary>技能</summary>
public sealed record SkillDto(
    string Guid, long Id, string Name, string Description, int Level, string SkillType,
    bool IsSuperSkill, bool IsMagic, bool IsActive, bool Enable, bool IsInEffect,
    double CurrentCD, double RealCD, double RealMPCost, double RealEPCost,
    bool CanSelectEnemy, bool CanSelectTeammate, bool CanSelectSelf,
    bool Usable, string UnusableReason);

/// <summary>物品</summary>
public sealed record ItemDto(
    string Guid, long Id, string Name, string Description, string ItemType,
    bool IsActive, bool Enable, bool IsInGameItem, int RemainUseTimes, bool Usable, string UnusableReason);

/// <summary>角色</summary>
public sealed record CharacterDto(
    string Guid, long Id, string Name, string FirstName, string NickName, string DisplayName,
    int Level, double HP, double MaxHP, double MP, double MaxMP, double EP, double MaxEP,
    int MOV, string State, bool IsPlayer, bool IsAI, bool IsEliminated, long GridId,
    List<SkillDto> Skills, List<ItemDto> Items, List<string> Effects);

/// <summary>行动顺序表条目</summary>
public sealed record QueueEntryDto(string Guid, string DisplayName, double HardnessTime, int Order, bool IsPlayer);

/// <summary>决策点</summary>
public sealed record DecisionPointsDto(
    int Current, int Max, int Cost, int ActionsTaken, int Recovery, Dictionary<string, int> ActionCosts);

/// <summary>对局状态快照</summary>
public sealed record GameStateDto(
    string GameId, string Mode, int Round, double TotalTime, bool Running, bool GameOver,
    MapDto? Map, List<CharacterDto> Characters, List<QueueEntryDto> Queue,
    DecisionPointsDto? PlayerDP, string? PlayerGuid, string? CurrentActorGuid,
    Dictionary<string, List<string>> RoundRewards);

/// <summary>赛后结算条目</summary>
public sealed record RankingDto(
    int Rank, string Guid, string DisplayName, bool IsPlayer, bool IsWinner,
    double Rating, int Kills, int Deaths, int Assists,
    double TotalDamage, double TotalHeal, double TotalShield,
    int LiveRound, int ActionTurn, double LiveTime, string TeamName);

/// <summary>角色选择候选项</summary>
public sealed record CharacterOptionDto(string Guid, long Id, string Name, string FirstName, string NickName, string DisplayName, string Info);

// ==================== 实体 → DTO 映射 ====================

public static class SoloGameMapper
{
    public static GridDto ToGrid(Grid g) =>
        new(g.Id, g.X, g.Y, g.Z, g.Color.Name, [.. g.Characters.Select(c => c.Guid.ToString())]);

    public static MapDto? ToMap(GameMap? map)
    {
        if (map is null) return null;
        return new MapDto(map.Name, map.Length, map.Width, map.Height, map.Size,
            [.. map.Grids.Values.OrderBy(g => g.Id).Select(ToGrid)]);
    }

    /// <summary>技能可用性判定（移植自 WPF 的 SkillUsabilityConverter）</summary>
    public static (bool Usable, string Reason) SkillUsability(Skill s, Character owner)
    {
        if (s.Level <= 0) return (false, "未学习");
        if (s.SkillType == SkillType.Passive) return (false, "被动技能");
        if (!s.Enable) return (false, "已禁用");
        if (s.IsInEffect) return (false, "生效中");
        if (s.CurrentCD > 0) return (false, $"冷却剩余 {s.CurrentCD:0.##} 秒");

        bool isEpSkill = s.SkillType is SkillType.SuperSkill or SkillType.Skill;
        bool isMpSkill = s.SkillType == SkillType.Magic;

        if (isEpSkill && s.RealEPCost > owner.EP) return (false, $"能量不足，需 {s.RealEPCost:0.##} 点");
        if (isMpSkill && s.RealMPCost > owner.MP) return (false, $"魔法不足，需 {s.RealMPCost:0.##} 点");
        if (!isEpSkill && !isMpSkill)
        {
            if (s.RealEPCost > owner.EP && s.RealMPCost > owner.MP) return (false, $"能量/魔法不足");
        }
        return (true, "");
    }

    public static SkillDto ToSkill(Skill s, Character owner)
    {
        (bool usable, string reason) = SkillUsability(s, owner);
        return new SkillDto(
            s.Guid.ToString(), s.Id, s.Name, s.Description ?? "", s.Level, s.SkillType.ToString(),
            s.IsSuperSkill, s.IsMagic, s.IsActive, s.Enable, s.IsInEffect,
            s.CurrentCD, s.RealCD, s.RealMPCost, s.RealEPCost,
            s.CanSelectEnemy, s.CanSelectTeammate, s.CanSelectSelf,
            usable, reason);
    }

    public static (bool Usable, string Reason) ItemUsability(Item i, Character owner)
    {
        if (!i.IsActive || i.Skills.Active is null) return (false, "无主动效果");
        if (!i.Enable || !i.IsInGameItem) return (false, "不可用");
        Skill active = i.Skills.Active;
        if (!active.Enable) return (false, "已禁用");
        if (active.IsInEffect) return (false, "生效中");
        if (active.CurrentCD > 0) return (false, $"冷却剩余 {active.CurrentCD:0.##} 秒");
        if (active.RealMPCost > owner.MP) return (false, $"魔法不足，需 {active.RealMPCost:0.##} 点");
        if (active.RealEPCost > owner.EP) return (false, $"能量不足，需 {active.RealEPCost:0.##} 点");
        return (true, "");
    }

    public static ItemDto ToItem(Item i, Character owner)
    {
        (bool usable, string reason) = ItemUsability(i, owner);
        return new ItemDto(
            i.Guid.ToString(), i.Id, i.Name, i.Description ?? "", i.ItemType.ToString(),
            i.IsActive, i.Enable, i.IsInGameItem, i.RemainUseTimes, usable, reason);
    }

    public static CharacterDto ToCharacter(Character c, GameMap? map, string? playerGuid, GamingQueue? queue, ICollection<Character>? eliminated = null)
    {
        Grid? grid = map?.GetCharacterCurrentGrid(c);
        bool isAI = queue?.IsCharacterInAIControlling(c) ?? false;
        // v3 的 Skills / Items / Effects 均为 HashSet，需显式排序保证快照稳定
        List<SkillDto> skills = [.. c.Skills
            .Where(s => s.SkillType != SkillType.Passive)
            .OrderBy(s => s.SkillType.ToString()).ThenBy(s => s.Name)
            .Select(s => ToSkill(s, c))];
        List<ItemDto> items = [.. c.Items
            .Where(i => i.IsActive)
            .OrderBy(i => i.Name)
            .Select(i => ToItem(i, c))];
        List<string> effects = [.. c.Effects.Where(e => e.IsInEffect).Select(e => e.Name)];

        return new CharacterDto(
            c.Guid.ToString(), c.Id, c.Name, c.FirstName, c.NickName, c.ToStringWithLevel(),
            c.Level, c.HP, c.MaxHP, c.MP, c.MaxMP, c.EP,
            General.GameplayEquilibriumConstant.MaxEP,
            c.MOV, c.CharacterState.ToString(),
            c.Guid.ToString() == playerGuid, isAI,
            eliminated?.Contains(c) ?? false,
            grid?.Id ?? -1,
            skills, items, effects);
    }

    public static DecisionPointsDto? ToDP(DecisionPoints? dp)
    {
        if (dp is null) return null;
        Dictionary<string, int> costs = [];
        foreach (KeyValuePair<CharacterActionType, int> kv in dp.ActionTypes)
        {
            costs[kv.Key.ToString()] = kv.Value;
        }
        return new DecisionPointsDto(
            dp.CurrentDecisionPoints, dp.MaxDecisionPoints, dp.DecisionPointsCost,
            dp.ActionsTaken, dp.RecoverDecisionPointsPerRound, costs);
    }

    public static CharacterOptionDto ToOption(Character c) =>
        new(c.Guid.ToString(), c.Id, c.Name, c.FirstName, c.NickName, c.ToStringWithLevel(), c.GetInfo(false, false));
}
