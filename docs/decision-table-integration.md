# 真实模组决策表集成测试

测试入口：`WebAPI/Program.cs` 的 `--test-decision-table`。入口加载角色、技能、物品和职业模组，随后运行 `WebAPI/Tests/DecisionTableTest*.cs`，不启动 HTTP 服务，不覆盖 `rounds_archive.zip`。

## 运行

在 Testing-v3 仓库根目录运行，要求 .NET SDK 10：

```powershell
$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
$env:DOTNET_CLI_HOME = Join-Path (Get-Location) 'artifacts/dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
& $dotnet build FunGame.Testing-v3.slnx -c Release --no-restore -m:1 -nr:false
& $dotnet WebAPI/bin/Release/net10.0/FunGame.Testing-v3.WebAPI.dll --test-decision-table
& $dotnet WebAPI/bin/Release/net10.0/FunGame.Testing-v3.WebAPI.dll --test-chain-action
```

首次获取仓库、尚未还原依赖时先执行 `& $dotnet restore FunGame.Testing-v3.slnx`。SDK、构建和日志产物位于忽略目录，Core 通过已有项目引用参与构建。

按场景名称筛选：

```powershell
& $dotnet WebAPI/bin/Release/net10.0/FunGame.Testing-v3.WebAPI.dll --test-decision-table '--decision-filter=回复弹'
& $dotnet WebAPI/bin/Release/net10.0/FunGame.Testing-v3.WebAPI.dll --test-decision-table '--decision-filter=有界空表对照'
```

任何断言失败，或筛选没有匹配场景，进程返回 1；全部断言通过返回 0。SDK 必须通过版本检查：测试环境中直接执行 `dotnet` 曾解析到 .NET 8，以上命令显式选取安装了 .NET 10 的路径。

## 配置与测试覆盖

现有模组目录包含 18 个角色、267 个技能和 69 个物品。测试使用真实角色、技能和特效结算，没有替换伤害、治疗或资源扣除实现。

| 范围 | 检查内容 |
| --- | --- |
| 配置与目录 | 加载 `Tests/Fixtures/decision-tables/healer.json`；与 Builder 配置一致；根据真实资源目录拒绝未知技能 |
| 角色生命周期 | 复制保留策略；JSON 保存策略 ID，恢复后显式重新绑定 |
| 目标与优先级 | 回复弹绑定低血量友军；回复术过滤满血角色；疾风步排除不可选中目标；宿主动作优先于角色策略 |
| 实际结算 | 地图/非地图回复弹的治疗、EP、冷却与贡献；金刚击的伤害与扣费；冰霜攻击的吟唱、延迟 MP 消耗和伤害；小回复药扣次数并移除 |
| 合法性 | 冷却、EP、决策点、启用状态阻止规则；动作开始的失效方案重验不扣资源 |
| 协同 | 治疗策略选中已经出队的回合角色，验证治疗记录与回合归属；有限射程协同禁止移动 |
| 地图 | 有限射程移动后执行金刚击；风险上限拒绝危险吟唱；全图指向性原地规划 |
| 范围 | 火山咆哮保留空地中心并覆盖施法距离之外的角色；与全量落点参考比较覆盖数；实际吟唱后结算两个敌人的伤害；岩石之息与地狱之门的假设位置投影与真实移动一致 |
| 回退与对局 | 空表保持 WeightedNearBest 的默认选择序列；两种新 AI 模式、地图/非地图固定种子策略对局和有界空表对照 |

测试夹具统一设置角色等级、生命/魔法初值、EP、决策点和固定 GUID，分别隔离各断言。`InvalidateSkillEffect` 仅在动作开始时注入冷却变更，模拟规划后状态失效；被验证技能仍为真实金刚击。完整战斗使用模组角色的原有属性、个人技能及被动，再学习回复弹、金刚击、冰霜攻击和火山咆哮。

规则表与资源目录的辅助代码在 `DecisionTableTest.Fixture.cs`；普通执行在 `DecisionTableTest.cs`；空间用例在 `.Map.cs`；完整对局、对照与采样在 `.Battle.cs`。所有对象级订阅限定在各测试夹具内。

## 验证结果

Core 基准提交为 `1f755dd`（#198）。本轮只修改 Testing-v3，使用当前分支 `master`；Core 工作区保持干净。

- Release 解决方案构建：0 警告、0 错误。
- 决策表专项：39/39 断言通过。
- 现有协同专项：17/17 通过，包含回合奖励与特效自动记录回归。
- 固定种子为 20261012、20261013、20261014。地图/非地图 × Deterministic/WeightedNearBest 共 12 组策略对局，每组运行两次，全部正常结束且行动序列一致，共 24 局。
- 12 局空表对照中 11 局正常结束，1 局达到 1000 回合上限。所有对照检查动作数量、硬直与资源数值；达到上限的对照必须在末 200 回合仍有有效伤害或治疗行动。

完整策略对局必须在 1000 回合内结束；动作上限为 5000。空表对照用于观测默认 AI，允许记录有有效行动的长局，不把达到预算上限记录为胜负已经产生。

### 长局观测

`seed=20261014, map=False, mode=WeightedNearBest, policy=False` 达到 1000 回合上限，记录 1220 次行动，仍有两名角色存活。末 200 回合有 190 次有效伤害或治疗行动，HP 总和从第 800 回合的 2536.7 变为第 1000 回合的 2436.6。

| 存活角色 | HP | MP | EP | 状态 |
| --- | ---: | ---: | ---: | --- |
| Oshima | 1274.0 | 36.1 | 45.3 | Actionable |
| Cold | 1162.6 | 133.9 | 21.2 | Actionable |

可观察到攻击与回复持续交替，尚未验证该对照最终是否结束，不据此宣称无限循环。相同种子和模式的决策表对局在 107 回合结束。该结果也不能用于推导策略普遍更强或所有模组组合都可有限结束。

### 规划采样

采样仅测量原地规则规划与上下文构建，不包含吟唱结算、完整站位搜索或整局运行。每项预热 1 次、采样 50 次；地图为 48×48，技能使用真实模组实例。本机一次最终运行数据，单位毫秒，不设时间断言。

| 场景 | 中位数 | P95 | 评估位置 | 实际范围投影 |
| --- | ---: | ---: | ---: | ---: |
| 非地图冰霜攻击 | 0.009 | 0.013 | 1 | 0 |
| 地图全图冰霜攻击 | 0.016 | 0.018 | 1 | 0 |
| 地图全图火山咆哮 | 0.339 | 0.417 | 1 | 36 |

12×12 范围专项中，有限射程生成并投影 15 个落点，全图施法生成并投影 40 个落点，均选中空地中心 `(8,4)` 并覆盖两个敌人。

完整输出保存在忽略目录 `artifacts/decision-tables-final.log` 与 `artifacts/chain-action-final.log`。测试说明及 JSON 夹具属于可提交源码，日志不纳入提交。
