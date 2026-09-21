namespace Milimoe.FunGameTesting.Tests
{
    /// <summary>
    /// <see cref="FunGameSimulation.StartSimulationGame"/> 的参数包，替代原先一长串位置 / 命名参数
    /// <para/>· 用法：<c>new SimulationOptions { IsTeam = true, BindToCharacter = true }</c>
    /// <para/>· <see cref="MaxRespawnTimesMix"/> 在 <c>new</c> 时默认为 1（与旧版可选参数默认值一致），其余字段默认为 false
    /// </summary>
    public struct SimulationOptions
    {
        /// <summary>控制台输出开关（旧参数 printout）</summary>
        public bool PrintOut { get; set; }

        /// <summary>Web 模式：影响回合消息的收集与输出</summary>
        public bool IsWeb { get; set; }

        /// <summary>团队模式（TeamGamingQueue），否则为混战模式（MixGamingQueue）</summary>
        public bool IsTeam { get; set; }

        /// <summary>死斗模式输出逐回合详情</summary>
        public bool DeathMatchRoundDetail { get; set; }

        /// <summary>混战模式的最大复活次数</summary>
        public int MaxRespawnTimesMix { get; set; }

        /// <summary>启用商店（仅团队模式生效）</summary>
        public bool UseStore { get; set; }

        /// <summary>是否加载地图</summary>
        public bool HasMap { get; set; }

        /// <summary>调试模式（输出更多运行细节）</summary>
        public bool IsDebug { get; set; }

        /// <summary>是否启用「角色绑定的回合奖励」（对应 <c>InitRoundRewards</c> 的 bindToCharacter）</summary>
        public bool BindToCharacter { get; set; }

        /// <summary>
        /// 构造参数包：<see cref="MaxRespawnTimesMix"/> 默认 1，其余布尔默认 false
        /// </summary>
        public SimulationOptions()
        {
            MaxRespawnTimesMix = 1;
        }
    }
}
