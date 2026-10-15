using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Interface.Base;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.DecisionTable;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;

namespace Milimoe.FunGameTesting.Tests;

public static partial class DecisionTableTest
{
    private sealed class Fixture
    {
        internal Character Actor { get; } = new OshimaShiya();
        internal Character Patient { get; } = new NanGanYu();
        internal Character Ally { get; } = new Yang();
        internal Character Enemy { get; } = new XinYin();
        internal Character OtherEnemy { get; } = new ColdBlue();
        internal TeamGamingQueue Queue { get; }
        internal DecisionTableLoader Loader { get; } = NewLoader();
        internal List<string> Hits { get; } = [];
        internal List<Character> Characters => [Actor, Patient, Ally, Enemy, OtherEnemy];

        internal Fixture(bool mapMode = false, int size = 12, int seed = 20261014)
        {
            List<Character> characters = Characters;
            for (int index = 0; index < characters.Count; index++)
            {
                Character character = characters[index];
                character.Guid = new Guid(index + 1, 0, 0, new byte[8]);
                character.Level = 10;
                character.InitialHP = 5000;
                character.InitialMP = 2000;
                character.ExActionCoefficient = -1;
                character.ER = 0;
                character.Recovery(100d);
                character.EP = 100;
            }
            Queue = new(_ => { }, mapMode ? new DecisionMap(size) : null, seed: seed);
            Queue.InitCharacters(characters, regenerateGuids: false);
            Queue.AddTeam("support", [Actor, Patient, Ally]);
            Queue.AddTeam("opposition", [Enemy, OtherEnemy]);
            for (int index = 0; index < characters.Count; index++) Queue.AddCharacter(characters[index], index * .5, false);
            foreach (DecisionPoints points in Queue.CharacterDecisionPoints.Values)
                points.CurrentDecisionPoints = points.MaxDecisionPoints = 5;
            Queue.SetCharactersToAIControl(false, false, [.. characters]);
            Queue.AI!.SelectionMode = AISelectionMode.Deterministic;
            Register(Loader, DecisionTableBuilder.Create("oshima:test-idle").WithFallback("endTurn").Build());
            foreach (Character character in characters) Bind(Loader, character, "oshima:test-idle");
            Queue.AI.PolicyEvaluatedEvent += (character, result, _) =>
            {
                if (character == Actor && result.RuleId is string id) Hits.Add(id);
            };
            if (Queue.Map is GameMap map)
            {
                map.SetCharacterCurrentGrid(Actor, map[5, 4]!);
                map.SetCharacterCurrentGrid(Patient, map[4, 4]!);
                map.SetCharacterCurrentGrid(Ally, map[4, 5]!);
                map.SetCharacterCurrentGrid(Enemy, map[7, 4]!);
                map.SetCharacterCurrentGrid(OtherEnemy, map[8, 4]!);
            }
        }

        internal Skill Learn(Skill skill, Character? owner = null)
        {
            Character character = owner ?? Actor;
            skill.Level = 1;
            skill.AddSkillToCharacter(character);
            skill.GamingQueue = Queue;
            return skill;
        }

        internal void Use(DecisionTableConfig config, Character? owner = null)
        {
            Register(Loader, config);
            Bind(Loader, owner ?? Actor, config.Id);
        }

        internal DecisionEvaluationContext Context(bool chain = false, int planBudget = 4096)
        {
            List<Character> enemies = Queue.GetEnemies(Actor);
            List<Character> allies = Queue.GetTeammates(Actor);
            (List<Character> selectableAllies, List<Character> selectableEnemies, List<Skill> skills, List<Item> items) =
                Queue.GetTurnStartNeedyList(Actor, allies, enemies);
            Grid? origin = Queue.Map?.GetCharacterCurrentGrid(Actor);
            return new() { Queue = Queue, Actor = Actor, Points = Queue.CharacterDecisionPoints[Actor], TurnOrigin = origin,
                Enemies = enemies, Allies = allies, SelectableEnemies = selectableEnemies, SelectableAllies = selectableAllies,
                Skills = skills, Items = items, IsChainAction = chain, PlanBudget = planBudget,
                MoveGrids = origin == null ? [] : Queue.Map!.GetGridsByRange(origin, Actor.MOV, false) };
        }

        internal void RunActor()
        {
            Character actor = Queue.NextCharacter() ?? throw new InvalidOperationException("角色未出队。");
            Check(actor == Actor, $"预期 {Actor}，实际 {actor}。");
            Queue.ProcessTurn(actor);
        }

        internal void FinishCasting(Skill skill)
        {
            for (int index = 0; index < 50 && Actor.CharacterState == CharacterState.Casting; index++)
            {
                Character actor = Queue.NextCharacter() ?? throw new InvalidOperationException("吟唱期间队列为空。");
                Queue.ProcessTurn(actor);
            }
            Check(Actor.CharacterState != CharacterState.Casting, $"{skill.Name} 未完成吟唱。");
        }
    }

    private sealed class DecisionMap(int size) : GameMap
    {
        public override string Name => "Decision table integration";
        public override string Description => "真实模组决策表测试地图";
        public override string Version => "1";
        public override string Author => "Testing-v3";
        public override int Length => size;
        public override int Width => size;
        public override int Height => 1;
        public override float Size => 1;
        public override GameMap InitGamingQueue(IGamingQueue queue) { DecisionMap map = new(size); map.Load(); return map; }
    }

    private static DecisionTableLoader NewLoader() => new(new(skills: FunGameService.AllSkills.Select(s => s.Id), items: FunGameService.AllItems.Select(i => i.Id)));

    private static void Register(DecisionTableLoader loader, DecisionTableConfig config)
    {
        IReadOnlyList<DecisionDiagnostic> errors = loader.Register(config);
        Check(errors.Count == 0, string.Join("; ", errors));
    }

    private static void Bind(DecisionTableLoader loader, Character character, string id)
    {
        character.DecisionTableId = id;
        IReadOnlyList<DecisionDiagnostic> errors = loader.Bind(character);
        Check(errors.Count == 0, string.Join("; ", errors));
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void Equal(double expected, double actual, string message) =>
        Check(Math.Abs(expected - actual) < .001, $"{message}: expected={expected:0.####}, actual={actual:0.####}");
}
