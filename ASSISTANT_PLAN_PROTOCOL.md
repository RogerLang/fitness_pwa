# 练了么：ChatGPT 训练模板提案协议

本文定义 ChatGPT 等受授权助手如何通过用户的 Private GitHub 数据仓库提出训练模板修改，并让“练了么”在用户确认前不改动正式模板、Candidate Workout 或当前 Planned Workout。

## 核心数据层

计划系统分为四层：

1. `Template`：长期训练规则，正式数据，参与 GitHub 同步。
2. `Candidate Workout`：根据 Template + 历史 Session 生成的下一次训练草稿；每个 Template 一份，仅保存在本机。
3. `Planned Workout`：用户已经推送的下一次训练，全局最多一份，正式数据，独立参与 GitHub 同步。
4. `Session`：实际训练结果，作为历史事实保存。

ChatGPT Proposal 只进入 Template 层，不直接修改 Planned Workout 或 Session。

## 核心流程

用户只需要在聊天中描述模板修改需求：

1. ChatGPT 读取 Private GitHub 中最新的 `manifest.json` 和 `plans.json`。
2. ChatGPT 基于最新 `manifest.plans.revision` 生成 `assistant-proposal.json`。
3. App 在计划页固定的 ChatGPT Review 卡片中显示修改摘要。
4. 用户点击“确认修改”。
5. App 立即把候选内容写入正式 Template。
6. 对应 Template 的本地 Candidate Workout 强制失效，并立即按照最新 Template + 历史 Session 重新生成。
7. App 同步新的 `plans.json`；`Planned Workout` 保持原样，不随 Template 修改。
8. Proposal 完成使命后删除 `assistant-proposal.json`。

因此：

- “确认修改”只负责 `Proposal → Template`；
- “推送计划”只负责 `Candidate Workout → Planned Workout`；
- “保存本次训练”只负责 `Planned Workout → Session`。

## 安全边界

默认只允许提议修改训练模板。

除非用户另有明确要求，ChatGPT 不得直接修改：

- `planned-workout.json`
- `sessions/`
- `body/`
- GitHub Token 或任何同步凭据

训练历史保持 immutable。身体记录不参与普通计划修改。

## 正式同步文件

正式数据使用：

- `manifest.json`
- `plans.json`
- `planned-workout.json`（全局 Planned Workout；由 App 管理）
- `sessions/`
- `body/`

ChatGPT 创建提案前必须读取最新 `manifest.json` 和 `plans.json`，确认：

- manifest 格式为 `fitness-pwa-manifest-v3`
- plans 格式为 `fitness-plans-v3`
- `plans.json.revision` 与 `manifest.plans.revision` 一致

如果 plans revision 已变化，应基于最新内容重新计算提案，不能使用旧快照。

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

`proposedPlan` 目前仍是目标 Template 的完整候选快照，而不是零散 patch。后续可独立升级为 `operations[]`，不与本轮数据层拆分同时进行。

它可以包含：

- `name`
- `planId`
- `exercises`
- 模板级其他长期字段

它不得主动包含或修改：

- `plannedWorkout`
- `pendingAssistantChange`

App 确认时只采用长期 Template 字段，不把 Proposal 中的任何内容写入全局 Planned Workout。

## 动作身份规则

- 只调整名称措辞、纠正错别字：保留原 `exerciseId`。
- 真正更换训练动作：使用新的 `exerciseId`。
- 修改组数、次数范围、起始重量、重量步进、负重类型、备注等参数：保留原 `exerciseId`。
- 删除动作：历史 Session 保留。

例如：

`上斜哑铃推胸 → 上斜杠铃卧推`

属于真正换动作，应使用新的 `exerciseId`，避免两种动作的历史趋势混在一起。

### 旧数据没有显式 ID 时

旧 `plans.json` 可能没有显式 `planId/exerciseId`。App 会使用 deterministic legacy ID 规则补齐，并在下一次正式 plans 写入时持久化这些 ID。

ChatGPT 创建提案时可以：

- 用 `targetPlanName` 定位模板；
- 对未改动动作省略旧 `exerciseId`，让 App 按现有 deterministic 规则恢复身份；
- 如果只是改名但要保留同一动作身份，应携带原动作 ID；
- 真正替换动作时应明确使用新的 UUID `exerciseId`。

## App 读取与确认规则

App 只在已有 Private GitHub 同步凭据时读取提案。提案读取失败不得阻塞计划页。

App 校验：

- 仓库必须仍是 Private repository；
- `assistant-proposal.json.format` 必须为 `fitness-assistant-proposal-v1`；
- `basePlansRevision` 必须等于当前远端 `manifest.plans.revision`；
- 本机 Template 不能存在未同步修改；
- 目标 Template 必须存在；
- 候选 Template 中的 `exerciseId` 不能重复。

如果 base revision 已过期，App 不应用候选内容，只显示“修改已过期”。

### 待确认

此时：

- 正式 Template 未改动；
- 当前 Candidate Workout 未改动；
- 当前 Planned Workout 未改动；
- Review 卡片显示修改摘要和确认/忽略操作。

### 确认修改

用户点击“确认修改”后：

1. App 立即写入正式 Template；
2. 对应 Candidate Workout 无条件丢弃并按最新数据重新生成；
3. 当前全局 Planned Workout 保持原样；
4. App 尝试同步 Template；
5. Proposal 删除。

如果 GitHub 同步失败，本机 Template 与新 Candidate 仍保留，由正常同步冲突机制继续处理。

### 推送计划 / 去训练

这些按钮不再承担 ChatGPT Template 确认职责。

- “推送计划”：把当前 Candidate Workout 快照写成全局唯一 Planned Workout；已有 Planned Workout 直接覆盖，不二次确认。
- “去训练”：如果当前 Candidate 与 Planned Workout 不一致，先推送当前 Candidate；一致时直接进入训练。

## Candidate Workout 生命周期

Candidate Workout：

- 每个 Template 一份；
- 只保存在本机 IndexedDB；
- 跨页面和刷新保留；
- 不进入 Private GitHub；
- 用户修改重量、次数、组数后标记为人工编辑。

Template 被本机手动修改或 ChatGPT 确认修改时，Candidate 强制重建。

历史 Session 或远端同步使生成依据变化时：

- 未人工编辑的 Candidate 自动重建；
- 已人工编辑的 Candidate 保留，并显示“训练依据已更新”，由用户选择“保留当前调整”或“重新生成”。

## Planned Workout 规则

Planned Workout 是全局唯一短期正式对象，不再挂在单个 Template 内。

- 独立 revision；
- 独立 GitHub 同步；
- 点击推送直接覆盖旧 Planned Workout；
- Template 后续修改不会反向修改已经推送的 Planned Workout；
- 完成训练并写入 Session 后，当前 Planned Workout 清空。

## 冲突处理

Template 与 Planned Workout 使用各自独立的 revision 冲突保护。

- Template 冲突不应静默覆盖。
- Planned Workout 冲突不应静默覆盖。
- Candidate Workout 不参与远端冲突体系。
- 当前训练存在未保存输入时，更新 Template 或 Planned Workout 的远端操作继续优先保护训练输入。

## 实现原则

- Proposal 功能是可失败的附加层，不能成为计划页硬依赖。
- Candidate 与 Planned Workout 必须是两个不同的数据对象。
- Template 中不再保存正式 `plannedWorkout`。
- GitHub API / 网络失败不能阻塞页面切换。
- Training 页交互、训练历史、身体数据和进阶算法保持独立。
