using FunGame.Core.Entity;
using FunGame.Core.Model;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.Tests;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>
/// 职业规划 REST 端点：会话式接口，前端以 sessionId 串联「选职业 → 升级 → 学技能 → 分配属性 → 物化 → 存档」
/// </summary>
public static class ClassPlanEndpoints
{
    /// <summary>
    /// 注册职业规划端点（/api/classplan/*）
    /// </summary>
    public static void MapClassPlanEndpoints(this WebApplication app)
    {
        RouteGroupBuilder group = app.MapGroup("/api/classplan");

        // ============ 可用职业 / 流派定义（含技能池、天赋池、模板限值） ============
        group.MapGet("/definitions", () =>
        {
            List<object> classes = [];
            foreach (string classId in ClassDefinitionRegistry.RegisteredClassIds)
            {
                Class? definition = ClassDefinitionRegistry.CreateClass(classId);
                if (definition is null)
                {
                    continue;
                }
                List<object> subClasses = [];
                foreach (string subId in ClassDefinitionRegistry.RegisteredSubClassIds)
                {
                    SubClass? sub = ClassDefinitionRegistry.CreateSubClass(subId, definition);
                    if (sub is null || sub.Class.GetIdName() != definition.GetIdName())
                    {
                        continue;
                    }
                    subClasses.Add(new
                    {
                        id = sub.GetIdName(),
                        name = sub.Name,
                        roleTypes = sub.RoleTypes.Select(r => r.ToString()).ToArray(),
                        inherentPassiveGates = sub.InherentPassives.Keys.OrderBy(k => k).ToArray()
                    });
                }
                classes.Add(new
                {
                    id = definition.GetIdName(),
                    name = definition.Name,
                    attributeLimit = definition.AttributeLimit?.Describe() ?? "无上下限",
                    skills = definition.Skills.Select(ToSkillDto).ToArray(),
                    passives = definition.PassiveSkills.Select(ToSkillDto).ToArray(),
                    magics = definition.Magics.Select(ToSkillDto).ToArray(),
                    superSkills = definition.SuperSkills.Select(ToSkillDto).ToArray(),
                    talents = definition.CombatTalents.ToDictionary(
                        kv => kv.Key.ToString(),
                        kv => kv.Value.Select(ToSkillDto).ToArray()),
                    subClasses
                });
            }
            return Results.Ok(new
            {
                classes,
                rules = new
                {
                    initialBudget = "30 点属性 + 3.0 成长（受职业与角色模板上下限约束）",
                    numericBoostBudget = "9 点属性 + 0.9 成长（可任意分配，不受限）",
                    selectionEnabled = true
                }
            });
        });

        // ============ 创建规划会话（可从存档恢复） ============
        group.MapPost("/sessions", async (CreateClassPlanSessionRequest request, ClassPlanSessionStore sessions, ClassPlanStore store, CancellationToken ct) =>
        {
            Character? template = ResolveTemplate(request);
            if (template is null)
            {
                return Results.NotFound(new { error = "找不到角色模板，请检查 characterId / characterName" });
            }
            Character player = template.Copy();
            Guid storeGuid = request.StoreGuid is { } guid && guid != Guid.Empty ? guid : template.Guid != Guid.Empty ? template.Guid : Guid.NewGuid();
            ClassPlanSession session = sessions.Create(player, storeGuid, request.SkillSelection);
            List<string> warnings = [];
            if (request.Restore)
            {
                ClassPlanSnapshot? snapshot = await store.LoadAsync(storeGuid, ct);
                if (snapshot is null)
                {
                    warnings.Add("未找到职业计划存档，已创建新计划。");
                }
                else
                {
                    warnings.AddRange(snapshot.ApplyTo(session.Planner.Plan, player));
                    session.Planner.SyncRewards();
                    session.Planner.Plan.ApplyTo(player);
                }
            }
            return Results.Ok(BuildSessionDto(session, warnings));
        });

        // ============ 查询会话状态 ============
        group.MapGet("/sessions/{id}", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            return session is null
                ? Results.NotFound(new { error = $"会话不存在：{id}" })
                : Results.Ok(BuildSessionDto(session, []));
        });

        // ============ 选择职业与流派 ============
        group.MapPost("/sessions/{id}/select-class", (string id, SelectClassRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? classDef = ClassDefinitionRegistry.CreateClass(request.ClassId);
            SubClass? subClassDef = classDef is null ? null : ClassDefinitionRegistry.CreateSubClass(request.SubClassId, classDef);
            if (classDef is null || subClassDef is null)
            {
                return Results.BadRequest(new { error = $"未注册的职业或流派：{request.ClassId} / {request.SubClassId}" });
            }
            ClassPlanResult result = session.Planner.SelectClass(classDef, subClassDef);
            return BuildActionResult(session, result);
        });

        // ============ 职业升级 ============
        group.MapPost("/sessions/{id}/upgrade-class", (string id, ClassIdRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            ClassPlanResult result = session.Planner.UpgradeClass(record);
            return BuildActionResult(session, result);
        });

        // ============ 学习职业技能 / 被动（消耗选择权） ============
        group.MapPost("/sessions/{id}/learn-skill", (string id, LearnSkillRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            Skill? skill = DefaultClassRewardSettler.AllPoolSkills(record).FirstOrDefault(s => s.Id == request.SkillId);
            if (skill is null)
            {
                return Results.BadRequest(new { error = $"技能不在该职业池中：{request.SkillId}" });
            }
            ClassPlanResult result = session.Planner.LearnClassSkill(record, skill);
            if (result.Success)
            {
                session.Planner.Plan.ApplyTo(session.Character);
            }
            return BuildActionResult(session, result);
        });

        // ============ 分配核心属性（1 级初始分配 / 4 与 9 级数值提升） ============
        group.MapPost("/sessions/{id}/allocate", (string id, AllocateRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            ClassAttributeAllocation allocation = new(request.STR, request.AGI, request.INT, request.STRGrowth, request.AGIGrowth, request.INTGrowth);
            ClassPlanResult result = request.Initial
                ? session.Planner.TakeInitialAllocation(record, allocation)
                : session.Planner.TakeNumericBoost(record, allocation);
            return BuildActionResult(session, result);
        });

        // ============ 物化到角色（按已习得挂载） ============
        group.MapPost("/sessions/{id}/apply", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            session.Planner.Plan.ApplyTo(session.Character);
            bool valid = session.Planner.ValidateState(out string? error);
            return Results.Ok(new
            {
                ok = true,
                valid,
                error,
                message = $"已物化职业计划：职业 {session.Planner.Plan.Classes.Count} 个，已学天赋 {session.Planner.Plan.LearnedTalentCount} 个。",
                plan = ClassPlanSnapshot.Capture(session.Planner.Plan)
            });
        });

        // ============ 洗点 ============
        group.MapPost("/sessions/{id}/reset", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            ClassPlanResult result = session.Planner.ResetPlan();
            return BuildActionResult(session, result);
        });

        // ============ 保存 / 删除存档 ============
        group.MapPost("/sessions/{id}/save", async (string id, ClassPlanSessionStore sessions, ClassPlanStore store, CancellationToken ct) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            await store.SaveAsync(session.StoreGuid, ClassPlanSnapshot.Capture(session.Planner.Plan), ct);
            return Results.Ok(new { ok = true, storeGuid = session.StoreGuid, path = store.GetPath(session.StoreGuid) });
        });

        group.MapDelete("/sessions/{id}", async (string id, ClassPlanSessionStore sessions, ClassPlanStore store, CancellationToken ct) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            bool deleted = await store.DeleteAsync(session.StoreGuid, ct);
            sessions.Remove(id);
            return Results.Ok(new { ok = true, archiveDeleted = deleted });
        });
    }

    private static Character? ResolveTemplate(CreateClassPlanSessionRequest request)
    {
        List<Character> templates = [.. FunGameService.Characters];
        if (templates.Count == 0)
        {
            return null;
        }
        if (request.CharacterId is { } id && templates.FirstOrDefault(c => c.Id == id) is { } byId)
        {
            return byId;
        }
        if (!string.IsNullOrWhiteSpace(request.CharacterName) && templates.FirstOrDefault(c => c.Name == request.CharacterName || c.NickName == request.CharacterName) is { } byName)
        {
            return byName;
        }
        return templates[0];
    }

    private static Class? FindRecord(ClassPlanSession session, string classId)
    {
        return session.Planner.Plan.Classes.FirstOrDefault(c => c.GetIdName() == classId);
    }

    private static object ToSkillDto(Skill skill) => new
    {
        id = skill.Id,
        name = skill.Name,
        skillType = skill.SkillType.ToString(),
        level = skill.Level,
        requiredSubClass = skill.RequiredSubClass?.GetIdName(),
        requiredAttribute = skill.RequiredAttribute?.ToString(),
        requiredAttributeValue = skill.RequiredAttributeValue
    };

    private static IResult BuildActionResult(ClassPlanSession session, ClassPlanResult result)
    {
        return result.Success
            ? Results.Ok(new { ok = true, message = result.Message, plan = ClassPlanSnapshot.Capture(session.Planner.Plan) })
            : Results.BadRequest(new { ok = false, message = result.Message });
    }

    private static object BuildSessionDto(ClassPlanSession session, List<string> warnings)
    {
        CharacterClass plan = session.Planner.Plan;
        return new
        {
            sessionId = session.Id,
            storeGuid = session.StoreGuid,
            character = new
            {
                id = session.Character.Id,
                name = session.Character.Name,
                nickName = session.Character.NickName,
                level = session.Character.Level,
                primaryAttribute = session.Character.PrimaryAttribute.ToString(),
                initialSTR = session.Character.InitialSTR,
                initialAGI = session.Character.InitialAGI,
                initialINT = session.Character.InitialINT,
                strGrowth = session.Character.STRGrowth,
                agiGrowth = session.Character.AGIGrowth,
                intGrowth = session.Character.INTGrowth
            },
            plan = ClassPlanSnapshot.Capture(plan),
            skillSelectionEnabled = plan.SkillSelectionEnabled,
            classPoints = plan.ClassPoints,
            warnings
        };
    }
}

/// <summary>创建规划会话请求</summary>
public record CreateClassPlanSessionRequest(long? CharacterId = null, string? CharacterName = null, Guid? StoreGuid = null, bool Restore = false, bool SkillSelection = true);

/// <summary>选择职业与流派请求（均为 IdName）</summary>
public record SelectClassRequest(string ClassId, string SubClassId);

/// <summary>职业 IdName 请求</summary>
public record ClassIdRequest(string ClassId);

/// <summary>学习技能请求</summary>
public record LearnSkillRequest(string ClassId, long SkillId);

/// <summary>核心属性分配请求</summary>
public record AllocateRequest(string ClassId, bool Initial = false, double STR = 0, double AGI = 0, double INT = 0, double STRGrowth = 0, double AGIGrowth = 0, double INTGrowth = 0);
