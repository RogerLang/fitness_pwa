# 练了么：ChatGPT 训练计划提案协议

本文定义 ChatGPT 等受授权助手如何通过用户的 Private GitHub 数据仓库提出训练模板修改，并让“练了么”在用户确认前不改动正式模板和当前待训练计划。

## 核心流程

用户只需要在聊天中描述修改需求：

1. ChatGPT 读取 Private GitHub 中最新的 `manifest.json` 和 `plans.json`。
2. ChatGPT 基于最新 plans revision 生成 `assistant-proposal.json`。
3. App 打开计划页时读取这份提案，并显示候选模板和候选训练计划。
4. 用户先点击“确认修改”。这一步只是在当前 App 会话中批准候选内容，不写入正式模板。
5. 用户随后点击现有“推送计划”或“去训练”。
6. App 才把候选模板写入正式 `plans[]`，同时把候选训练计划写成新的 `plannedWorkout`，并通过现有 GitHub 同步上传。
7. 同步成功后，App 删除 `assistant-proposal.json`。

因此，ChatGPT 可以帮用户完成繁琐的模板编辑，但用户始终保留最终确认权。

## 安全边界

默认只允许提议修改训练模板。

除非用户另有明确要求，ChatGPT 不得直接修改：

- `plannedWorkout`
- `sessions/`
- `body/`
- GitHub Token 或任何同步凭据

训练历史保持 immutable。身体记录不参与普通计划修改。

## 正式同步文件

现有正式数据继续使用：

- `manifest.json`
- `plans.json`
- `sessions/`
- `body/`

ChatGPT 在创建任何提案前必须读取最新 `manifest.json` 和 `plans.json`，确认：

- manifest 格式为 `fitness-pwa-manifest-v3`
- plans 格式为 `fitness-plans-v3`
- `plans.json.revision` 与 `manifest.plans.revision` 一致

如果 revision 已变化，应基于最新内容重新计算提案，不能使用旧快照。

## 提案文件

固定路径：

`assistant-proposal.json`

格式：

```json
{
  "format": "fitness-assistant-proposal-v1",
  "id": "<uuid>",
  "createdAt": "<ISO-8601>",
  "basePlansRevision": "<当前 manifest.plans.revision>",
  "targetPlanId": "<可选，优先用于匹配>",
  "targetPlanName": "周日｜胸",
  "summary": "把上斜哑铃推胸换成上斜杠铃卧推",
  "changes": [
    "上斜哑铃推胸 → 上斜杠铃卧推",
    "其他动作和训练参数保持不变"
  ],
  "proposedPlan": {
    "name": "周日｜胸",
    "exercises": []
  }
}
```

### proposedPlan 规则

`proposedPlan` 必须是目标模板的完整候选快照，而不是零散 patch。

它可以包含：

- `name`
- `planId`
- `exercises`
- 模板级其他长期字段

它不得主动包含或修改：

- `plannedWorkout`
- `pendingAssistantChange`

App 会始终从当前正式模板保留原 `plannedWorkout`，直到用户真正点击“推送计划”或“去训练”。

## 动作身份规则

- 只调整名称措辞、纠正错别字：保留原 `exerciseId`。
- 真正更换训练动作：使用新的 `exerciseId`。
- 修改组数、次数范围、起始重量、重量步进、负重类型、备注等参数：保留原 `exerciseId`。
- 删除动作：历史 session 保留。

例如：

`上斜哑铃推胸 → 上斜杠铃卧推`

属于真正换动作，应使用新的 `exerciseId`，避免两种动作的历史趋势混在一起。

### 旧数据没有显式 ID 时

Private 仓库中的旧 `plans.json` 可能还没有显式 `planId/exerciseId`。App 会通过当前 schema 的 deterministic legacy ID 规则补齐。

ChatGPT 创建提案时可以：

- 用 `targetPlanName` 定位模板；
- 对未改动动作省略旧 `exerciseId`，让 App 按现有 deterministic 规则恢复身份；
- 如果只是改名但要保留同一动作身份，应计算并携带原动作的 deterministic `exerciseId`；
- 真正替换动作时应明确使用新的 UUID 作为 `exerciseId`。

## App 读取规则

App 只在已有 Private GitHub 同步凭据时读取提案。

提案读取失败不得阻塞计划页。网络错误、格式错误或 GitHub API 错误只能让提案功能降级，原计划页必须继续正常工作。

App 校验：

- 仓库必须仍是 Private repository；
- `assistant-proposal.json.format` 必须为 `fitness-assistant-proposal-v1`；
- `basePlansRevision` 必须等于当前远端 `manifest.plans.revision`；
- 目标模板必须存在；
- 候选模板中的 `exerciseId` 不能重复。

如果 base revision 已过期，App 不应用候选内容，只显示“修改已过期”。

## 用户确认语义

### 待确认

App 显示：

- `ChatGPT 已调整 · 待确认`
- 修改摘要
- 候选模板
- 基于候选模板生成的候选训练计划

此时：

- 正式模板未改动；
- 当前 confirmed `plannedWorkout` 未改动；
- “推送计划”和“去训练”暂时不可用；
- 候选训练计划中的重量、次数、组数仍可由用户微调；
- 模板编辑器只作为候选预览，不允许直接编辑。

### 确认修改

用户点击“确认修改”后：

- 只在当前会话中批准候选内容；
- 仍不写入 GitHub；
- “推送计划”和“去训练”重新可用；
- 用户可以取消确认。

### 推送计划 / 去训练

用户点击现有按钮后：

1. App 将候选模板写入本机正式 `plans[]`；
2. 使用当前候选训练计划生成新的 confirmed `plannedWorkout`；
3. 通过现有 `App.sync.push()` 上传 `plans.json` 和 manifest revision；
4. 同步成功后删除 `assistant-proposal.json`。

如果 GitHub 同步失败，本机修改和本次训练计划仍保留，提案文件不删除，便于之后再次同步或恢复。

## 忽略提案

用户点击“忽略”时，App 删除 `assistant-proposal.json`，不修改正式模板、不修改当前待训练计划。

## 冲突处理

ChatGPT 创建提案后，如果远端 `plans.json` revision 发生变化，则原提案自动失效。

这保证：

- ChatGPT 不会基于旧模板静默覆盖新数据；
- 多设备已有的 revision 冲突保护继续生效；
- 当前训练存在未保存输入时，现有训练保护规则继续优先。

## 实现原则

提案功能应是可失败的附加层，不能成为计划页的硬依赖。

具体约束：

- 不把提案加载逻辑藏进 `training-insights.js` 等无关模块；
- 不动态加载不存在的本地脚本；
- 提案模块必须是明确的独立资源；
- GitHub API / 网络失败不能阻塞页面切换；
- Training 页交互、训练历史、身体数据和现有进阶算法保持独立。
