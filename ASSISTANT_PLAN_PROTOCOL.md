# 练了么：助手训练计划修改协议

本文定义 ChatGPT 等受授权助手如何通过用户的 Private GitHub 数据仓库修改训练模板，并让“练了么”在用户确认前保持当前待训练计划不变。

## 目标

用户只需要在聊天中描述训练计划修改需求。助手负责读取最新远端计划、修改长期训练模板并写回远端。App 下次同步后显示新的候选计划，由用户通过现有“推送训练计划”或“去训练”操作完成最终确认。

## 边界

默认只允许修改训练模板 `plans[]`。

除非用户另有明确要求，助手不得修改：

- `plannedWorkout`
- `sessions/`
- `body/`
- GitHub 同步凭据或任何 Token

训练历史保持 immutable。身体记录不参与普通计划修改。

## 远端文件

当前计划同步仍使用：

- `manifest.json`
- `plans.json`

助手在每次修改前必须读取最新 `manifest.json` 和 `plans.json`，确认：

- manifest 格式为 `fitness-pwa-manifest-v3`
- plans 格式为 `fitness-plans-v3`
- `plans.json.revision` 与 `manifest.plans.revision` 一致

如果 revision 已经变化，应基于最新内容重新计算修改，不能使用旧快照覆盖新数据。

## pendingAssistantChange

当助手完成模板修改时，在被修改的 plan 上增加：

```json
{
  "pendingAssistantChange": {
    "format": "fitness-assistant-change-v1",
    "id": "<uuid>",
    "createdAt": "<ISO-8601>",
    "baseRevision": "<修改前的 plans revision>",
    "summary": "简短说明这次修改",
    "changes": [
      "修改项 1",
      "修改项 2"
    ]
  }
}
```

`summary` 和 `changes` 只用于用户确认提示，不参与训练算法。

同一模板已有未确认助手修改时，新修改应基于当前最新模板继续更新，并用新的 `pendingAssistantChange` 描述最终仍待确认的状态。

## 动作身份规则

- 仅调整名称措辞、纠正错别字：保留原 `exerciseId`。
- 真正更换训练动作：生成新的 `exerciseId`。
- 修改组数、次数范围、重量步进、备注等参数：保留原 `exerciseId`。
- 删除动作：历史记录保留，不删除历史 session。

例如“哑铃上斜卧推”替换为“杠铃上斜卧推”属于真正换动作，应创建新的 `exerciseId`，避免两种动作的历史趋势混合。

## 写入规则

修改完成后：

1. 为 `plans.json` 生成新的 revision UUID。
2. 更新 `plans.json.updatedAt`。
3. 将 `manifest.plans.revision` 更新为同一个 revision。
4. 更新 `manifest.updatedAt`。
5. `manifest.json` 与 `plans.json` 应在同一个 Git commit 中原子写入。

不要先提交一个文件、再提交另一个文件，以免远端短暂出现 revision 不一致。

## App 确认语义

当某个 plan 带有 `pendingAssistantChange`：

- 当前已 confirmed 的 `plannedWorkout` 保持不变。
- 计划页基于修改后的模板重新生成候选计划。
- 页面提示“ChatGPT 已调整 · 待确认”。
- 用户仍可以在候选计划中手动微调重量、次数和组数。
- 用户点击“推送训练计划”或“去训练”后，新候选计划成为正式 `plannedWorkout`。
- 同时删除该 plan 的 `pendingAssistantChange`，再通过现有同步逻辑写回远端。

因此，助手修改模板本身不等于替用户确认下一次训练。

## 冲突处理

如果本机已有未同步的计划修改，现有同步冲突机制继续生效，App 不应静默覆盖本机计划。

如果当前训练已经产生未保存输入，App 不应在训练过程中拉取新的远端计划。

这些规则优先于助手修改带来的便利性。