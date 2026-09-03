# 练了么：技术文档

本文记录 `fitness_pwa` 的实现结构、数据模型、PWA 缓存、GitHub 同步协议和发布约定。日常使用与配置请优先查看 [README.md](./README.md)。

## 1. 总体架构

`fitness_pwa` 是一个无构建步骤的纯静态 PWA，前端直接由 HTML、CSS 和原生 JavaScript 组成。

核心设计原则：

- local-first：训练计划、训练历史和身体数据优先保存在浏览器 IndexedDB。
- 模块化：核心状态、训练逻辑、身体数据、备份、同步、动画分别拆分。
- 可离线：Service Worker 缓存完整静态 shell。
- 可选远端同步：通过 GitHub REST API 将数据同步到单独的 Private repository。
- 增量写入：训练记录和身体记录按条目保存，减少重复上传和历史文件重写。

应用页面包含四个主要区域：

- 训练：选择训练计划、记录重量/次数/RIR、完成组、调整动作。
- 历史：查看已经保存的训练记录。
- 趋势：查看动作训练趋势并记录身体数据。
- 设置：配置 GitHub 同步、本地备份和数据清理。

## 2. 文件结构

### 应用核心

- `index.html`：页面结构、资源入口和 CSP。
- `app-storage.js`：IndexedDB 打开、KV 读写以及主状态读取/写入。
- `app.js`：全局状态、应用启动、页面路由、模块注册、持久化钩子和数据重置协调。
- `app-body.js`：身体数据录入、保存和最近记录渲染。
- `app-backup.js`：本地 JSON 导出、导入和本机训练数据清空。

### 训练模块

- `training-progression.js`：历史上下文、次数区间、重量档位和进阶建议。
- `training-draft.js`：训练草稿、当前计划、组输入值和完成状态持久化。
- `training-render.js`：计划选择器、动作卡片、动作编辑器和训练页渲染。
- `training-insights.js`：历史记录、趋势区间和图表。
- `training-maintenance.js`：重复训练记录识别与清理。
- `training.js`：训练页事件、计划调整、训练保存及训练模块流程协调。
- `training-motion.js`：训练页滚动吸附、卡片定位和输入编辑相关交互。

### 同步模块

- `sync-remote.js`：GitHub API 请求、Base64、SHA-256、manifest 校验以及远端文件读写。
- `sync.js`：同步业务流程、计划冲突处理、本机同步凭据、同步元数据和按钮交互。

### PWA 与界面

- `sw-register.js`：注册 Service Worker。
- `sw.js`：静态 shell 缓存、离线导航和旧缓存清理。
- `rescue.html`：清理 Service Worker 和静态缓存的恢复入口，不删除 IndexedDB 训练数据。
- `styles.css`：基础布局和通用组件。
- `glass-cards.css`：视觉层级和卡片视觉系统。
- `nav-motion.css` / `nav-motion.js`：底部导航动画。
- `manifest.webmanifest`：PWA 名称、图标、启动范围和 standalone 配置。

## 3. 脚本加载顺序

当前 `index.html` 中的主要加载顺序为：

```text
sw-register.js
app-storage.js
app.js
app-body.js
app-backup.js
training-progression.js
training-draft.js
training-render.js
training-insights.js
training-maintenance.js
training.js
training-motion.js
nav-motion.js
sync-remote.js
sync.js
```

依赖关系应保持清晰：底层工具先注册到 `window`，上层模块再读取依赖并向 `FitnessApp` 注册生命周期函数。

`app.js` 负责统一启动和状态协调。跨模块的数据替换统一经过 `FitnessApp.resetData()`，避免各功能模块直接修改彼此内部状态。

## 4. 本地数据存储

### IndexedDB

数据库：

```text
DB_NAME: fitness-pwa-db
DB_VERSION: 1
Object Store: kv
```

主状态包含三类数据：

```text
plans
sessions
body
```

此外，训练草稿、同步凭据和同步元数据也保存在同一浏览器本地存储体系中。

### 训练计划

计划大致结构：

```json
{
  "name": "计划名称",
  "exercises": [
    {
      "name": "动作名称",
      "sets": 3,
      "repRange": [8, 12],
      "defaultWeight": 40,
      "weightStep": 5,
      "note": "",
      "optional": false
    }
  ]
}
```

动作还可以包含 `warmup`、`setPresets` 等用于专项热身的字段。

### 训练记录

保存训练时生成随机 UUID。每次训练记录包含日期、计划名称、动作和各组数据。

组数据主要包括：

```text
weight
reps
rir
completed
```

正式动作还会保存当次的计划建议快照，便于后续回看计划重量、目标次数和实际执行差异。

### 身体数据

单条身体记录包含：

```text
id
日期 date
体重 weight
胸围 chest
腰围 waist
臂围 arm
```

每条记录同样使用随机 UUID。

## 5. 本地备份格式

导出的 JSON 使用：

```text
format: fitness-pwa-backup-v3
```

主要内容为：

```text
plans
sessions
body
exportedAt
```

文件名格式：

```text
fitness-backup-YYYY-MM-DD.json
```

导入时会重新写入完整主状态。同步凭据不会写入导出的训练备份。

## 6. GitHub 同步配置

应用通过浏览器直接调用 GitHub REST API。同步目标必须为 Private repository，代码会读取仓库元数据并强制检查：

```text
private === true
visibility === "private"
```

推荐使用 Fine-grained personal access token，并只授权数据仓库：

- Contents: Read and write
- Metadata: Read

同步配置由三个字段组成：

```text
owner
repo
token
```

凭据可保存到当前浏览器 IndexedDB。`owner` 和 `repo` 还会额外保存为本机同步配置。Token 不会进入公开代码仓库，也不会进入训练备份 JSON。

## 7. 远端数据协议

Private 数据仓库采用：

```text
manifest.json
plans.json
sessions/<sha256(session-id)>.json
body/<sha256(record-id)>.json
```

### manifest

当前格式：

```text
fitness-pwa-manifest-v3
```

结构大致为：

```json
{
  "format": "fitness-pwa-manifest-v3",
  "updatedAt": "ISO time",
  "plans": {
    "path": "plans.json",
    "revision": "uuid"
  },
  "sessions": [],
  "body": []
}
```

`sessions` 和 `body` 保存对应条目文件的哈希名。

### plans.json

当前格式：

```text
fitness-plans-v3
```

每次更新训练计划时生成新的随机 `revision`。

### 单条训练记录

当前格式：

```text
fitness-session-v2
```

远端文件名由本地 session UUID 的 SHA-256 计算得到。下载时会重新计算哈希并执行完整性检查。

### 单条身体记录

当前格式：

```text
fitness-body-entry-v2
```

同样使用记录 UUID 的 SHA-256 作为文件名并执行完整性检查。

## 8. 增量同步流程

### Push：增量同步

主要步骤：

1. 保存当前同步配置。
2. 检查目标仓库为 Private repository。
3. 确保旧本地记录已经具备 UUID。
4. 读取本机计划同步元数据。
5. 下载 `manifest.json`。
6. 对训练记录和身体记录计算 ID 哈希。
7. 只上传远端缺少的条目文件。
8. 必要时更新 `plans.json`。
9. 更新 `manifest.json`。

训练记录和身体记录按不可变条目处理。已经存在的同名哈希文件会先经过格式与 ID 完整性验证。

### Pull：从 GitHub 合并

主要步骤：

1. 保存当前训练草稿。
2. 检查 Private repository。
3. 读取远端 manifest。
4. 判断训练计划 revision 是否变化。
5. 下载远端缺失的训练记录和身体记录。
6. 按集合方式合并历史记录。
7. 必要时替换训练计划。
8. 清理旧重复记录。
9. 写入 IndexedDB 并刷新界面。

## 9. 训练计划冲突

训练记录和身体记录采用增量集合合并；训练计划属于可编辑配置，因此使用 revision 进行冲突检测。

本机维护：

```text
plansBaseRevision
plansDirty
plansSig
```

其中：

- `plansBaseRevision`：本机最后一次确认过的远端 revision。
- `plansDirty`：本机计划在该 revision 之后是否发生修改。
- `plansSig`：当前 plans JSON 的 SHA-256 签名。

典型逻辑：

- 云端 revision 更新、本机没有修改：要求先 pull。
- 云端 revision 更新、本机也修改：阻止直接 push，并要求先 pull 后明确选择计划。
- pull 时发现双方都改过计划：弹出确认框，用户决定是否使用 GitHub 最新计划覆盖本机计划。

当前设计会保留训练历史和身体数据，计划冲突只影响 `plans`。

## 10. PWA 与 Service Worker

`manifest.webmanifest` 使用：

```text
display: standalone
start_url: ./
scope: ./
```

`sw.js` 维护完整的静态 shell 缓存。安装阶段重新请求并缓存所有静态资源，激活阶段删除旧的 `fitness-pwa-*` 缓存。

导航请求优先返回缓存中的 `index.html`，普通同源 GET 请求使用 cache-first。

GitHub API 请求属于跨域请求，不经过静态 shell 的同源缓存逻辑。

## 11. 静态资源版本管理

发布新版本时，应同步更新：

1. `index.html` 中 CSS/JS 的查询版本号，例如 `?v=67`。
2. `sw.js` 中对应的 `SHELL_ASSETS` 查询版本号。
3. `sw.js` 中 `SHELL_CACHE` 名称，例如 `fitness-pwa-shell-v67`。

三个位置应使用同一版本号，避免浏览器同时持有不同版本的模块文件。

如果静态缓存异常，可访问 `rescue.html` 清理 Service Worker 和 Cache Storage。该恢复入口不删除 IndexedDB 中的训练数据。

## 12. 安全与隐私

当前实现有以下边界：

- 应用没有 Analytics、广告或第三方统计 SDK。
- 主训练数据默认只存在当前浏览器 IndexedDB。
- GitHub 同步数据以普通 JSON 保存，没有端到端加密。
- 任何拥有 Private 数据仓库访问权限的人都可以读取其中的训练数据。
- 同步代码会拒绝 Public repository。
- Token 可持久化在当前浏览器 IndexedDB 中，因此共享设备上应谨慎使用“保存本机同步信息”。
- `index.html` 的 CSP 将网络连接限制到同源和 `https://api.github.com`。

## 13. 开发与发布约定

当前项目没有 npm、打包器或编译步骤。修改后可直接通过静态 HTTP 服务测试。

建议每次迭代至少检查：

- 首次打开应用是否能正常启动。
- IndexedDB 中已有数据能否正常读取。
- 训练草稿刷新后能否恢复。
- 保存训练后历史和趋势是否更新。
- 身体数据能否保存并显示。
- 本地 JSON 导出/导入是否正常。
- GitHub pull/push 是否通过 Private repository 检查。
- 双设备修改计划时是否触发 revision 冲突。
- 更新资源版本号后 Service Worker 是否切换到新缓存。
- `rescue.html` 是否只清理静态缓存，不影响训练数据。

## 14. 后续维护原则

- 已验证的功能优先合并到对应正式模块。
- 避免长期堆积只包含少量覆盖逻辑的临时补丁文件。
- `app.js` 继续只负责跨模块生命周期和核心状态协调。
- GitHub HTTP、远端格式与完整性校验继续集中在 `sync-remote.js`。
- 同步交互、计划冲突和本机同步状态继续集中在 `sync.js`。
- 修改远端格式时同时升级 `format` 标识，并明确迁移策略。
