# 练了么 Architecture

本文记录当前正式架构边界。目标不是追求框架化，而是保证训练数据语义清楚、状态来源唯一、页面模块可以独立演进。

## 1. 核心数据流

```text
Template
   ↓ 结合 Session 历史 + progression
Candidate Workout
   ↓ 用户确认推送
Planned Workout
   ↓ 实际训练
Session
```

ChatGPT 修改走侧向入口：

```text
Assistant Proposal
   ↓ 用户确认
Template
   ↓ 强制失效并重新生成
Candidate Workout
```

四层数据不得混用：

- **Template**：长期训练规则。
- **Candidate Workout**：下一次训练的本机工作草稿。
- **Planned Workout**：全局唯一、已经决定要执行的下一次训练。
- **Session**：实际完成的训练历史事实。

## 2. 持久化边界

### Template

- 正式状态：`App.state.plans`
- 本机：IndexedDB state store
- 云端：`plans.json`
- 冲突：独立 plans revision

Template 不得包含新的 `plannedWorkout`。旧数据中的嵌套 `plan.plannedWorkout` 只用于迁移。

### Candidate Workout

- 本机 key：`planningCandidatesV1`
- 正式模块：`js/training/candidate-workout.js`
- 每个 Template 一份 Candidate，以 `planId` 为业务主键
- 模板名称仅作为旧数据兼容回退
- 不上传 Private GitHub
- 刷新、切页面后保留
- Template 或历史变化时执行 stale / regenerate 规则

`candidate-workout.js` 是 Candidate 生命周期和本机持久化的唯一主要负责人。`planning-core.js` 只负责选择当前 Template、渲染 Candidate、接收编辑并调用 Candidate service。

### Planned Workout

- 本机 key：`plannedWorkoutV1`
- 正式模块：`js/training/planned-workout.js`
- 全局最多一份
- 云端：`planned-workout.json`
- 冲突：独立 plannedWorkout revision
- 完成对应 Session 后清空当前 Planned Workout

`planned-workout.js` 是 Planned Workout 状态的唯一主要负责人。其他模块通过它读取、确认、远端覆盖或清空当前待训练计划。

### Session

- 正式状态：`App.state.sessions`
- 训练完成后追加
- 云端：`sessions/<hash>.json`
- 视为历史事实，不随 Template / Candidate / Planned Workout 后续变化改写

## 3. 主要模块

```text
js/
├── core/
│   ├── app.js                 # 生命周期、页面加载、schema、persist hooks
│   └── app-storage.js         # IndexedDB 基础存储
│
├── training/
│   ├── candidate-workout.js   # Candidate 生成、持久化、edited/stale、失效/重建
│   ├── planning-core.js       # Plan 页面业务和 Candidate orchestration
│   ├── planning.js            # Plan 页面生命周期适配器
│   ├── planned-workout.js     # 全局 Planned Workout
│   ├── training-progression.js# 历史索引和进阶算法
│   ├── training-draft.js      # 正在训练时的未保存输入草稿
│   ├── training-render.js     # Training 页面渲染
│   └── training.js            # Session 保存和 Training orchestration
│
└── sync/
    ├── sync-remote.js              # plans / sessions / body 远端基础协议
    ├── sync-core.js                # 同步业务、revision、planned-workout.json
    ├── sync.js                     # Sync 生命周期和公开 App.sync 适配器
    ├── assistant-proposals-core.js # Proposal 校验、确认、清理
    └── assistant-proposals.js      # Proposal 页面生命周期适配器
```

`*-core.js` 是业务实现；同名入口文件负责接入 `FitnessApp` 生命周期。入口文件不得再次动态创建 `<script>`。

## 4. 两种 Draft 必须区分

### Candidate Workout

计划页里的“下一次建议怎么练”。

- 来源：Template + Session + progression
- 可以编辑
- 可以重新生成
- 可以推送成 Planned Workout

### Training Draft

训练页正在填写、尚未保存成 Session 的真实训练输入。

- 模块：`training-draft.js`
- 只服务当前正在执行的训练
- 刷新页面后可恢复

二者不能共用同一个 store、状态字段或生命周期。

## 5. 关键业务写入规则

### 修改 Template

来源可以是：

- 手动编辑模板
- ChatGPT Proposal 确认

结果：

1. Template 立即持久化。
2. 对应 Candidate 强制失效。
3. 自动生成新的 Candidate。
4. 已存在的 Planned Workout 保持不变。

### 重新生成

只操作 Candidate：

```text
Template + 最新 Session → Candidate
```

不得修改 Template、Planned Workout、Session。

### 推送计划

只执行：

```text
Candidate → Planned Workout
```

全局旧 Planned Workout 直接被新快照覆盖，不二次确认。

### 去训练

- Candidate 与当前 Planned Workout 相同：直接进入 Training。
- 不同：先推送当前 Candidate，再进入 Training。

### 保存训练

```text
Training Draft + Planned Workout → Session
```

保存成功后，如果 Session 对应当前 Planned Workout，则清空当前 Planned Workout。

## 6. Assistant Proposal 边界

固定远端文件：`assistant-proposal.json`

Proposal 本身不是正式训练数据。

确认 Proposal 时：

1. 校验 plans base revision。
2. 将候选模板写入 Template。
3. 持久化 Template。
4. 强制重新生成对应 Candidate。
5. 不修改当前 Planned Workout。
6. 同步成功后清理 Proposal 文件。

Proposal 网络错误不能阻塞 Plan 页面本身。

## 7. 页面加载原则

- Training 首屏依赖保持静态加载，避免训练页面闪烁和二次加载。
- Plan 页面通过 `PAGE_SCRIPTS` 按需加载。
- Plan 页依赖顺序显式声明：
  1. `candidate-workout.js`
  2. `planning-core.js`
  3. `planning.js`
  4. `assistant-proposals-core.js`
- 页面入口和同步入口不得再自行创建第二层本地 `<script>` loader。
- Service Worker shell cache 是发布资源版本边界，不恢复每文件 `?v=` 查询参数。

## 8. 兼容和迁移

v165 之前曾把 Planned Workout 嵌套在 Template 中。`planned-workout.js` 保留一次兼容迁移：

1. 找到旧的 confirmed `plan.plannedWorkout`。
2. 选择最新一份迁入全局 Planned Workout。
3. 从所有 Template 删除旧字段。
4. 后续只使用独立 Planned Workout store / remote file。

迁移代码可以在确认历史数据已经全部跨过旧 schema 后单独删除，不应与功能迭代混在一起。

## 9. 自动化回归保护

`scripts/check-static.mjs` 必须持续保护：

- 所有页面和 shell 资源存在。
- PAGE_SCRIPTS 资源进入 Service Worker shell。
- Candidate store 只由 `candidate-workout.js` 负责，Planning 不重新接管持久化。
- `planning-v165.js`、`sync-v165.js`、`assistant-proposals-v165.js`、`training-next-workout.js` 不得重新出现。
- 页面入口不得重新创建嵌套 script loader。
- Planning 不得把 Planned Workout 写回 Template。
- Planned Workout 必须使用独立本机 store 和 `planned-workout.json`。
- ChatGPT 确认必须立即持久化 Template、强制重建 Candidate，且不得顺带推送 Planned Workout。
- 已保护的 Training motion 参数不得回退。

浏览器 smoke test 必须持续验证：

- 页面能够真实启动和切换。
- Candidate 编辑可持久化并跨刷新恢复。
- Candidate 可以推送并覆盖全局 Planned Workout。
- Template 修改不会反向修改既有 Planned Workout。
- Session 完成会消费对应 Planned Workout。

## 10. 未来修改原则

优先做小范围增量改动：

- 新功能先确认属于 Template、Candidate、Planned Workout 还是 Session。
- 不在 UI 模块之间直接复制正式状态。
- 业务身份优先使用 `planId` / `exerciseId`；数组 index 只用于当前 UI 定位。
- 不为了代码形式统一而重写已经稳定的训练交互。
