# 练了么：技术文档

本文记录 `fitness_pwa` 当前目录结构、模块职责、本地数据、训练计划生命周期、PWA 缓存和 GitHub 同步实现。日常使用与配置见 [README.md](./README.md)。

## 1. 总体架构

`fitness_pwa` 是一个无构建步骤的纯静态 PWA，由 HTML、CSS 和原生 JavaScript 组成。

主要设计：

- local-first：训练数据优先保存到浏览器 IndexedDB
- 单向训练流程：训练模板 → 当前待训练计划 → 训练记录
- 模块化：核心状态、训练逻辑、同步和界面交互分别维护
- 可离线：Service Worker 缓存完整静态 shell
- 可选同步：通过 GitHub REST API 与单独的 Private repository 交换数据
- 增量记录：训练记录和身体记录按独立条目同步

## 2. 当前目录结构

```text
fitness_pwa/
├─ index.html
├─ manifest.webmanifest
├─ sw.js
├─ rescue.html
├─ README.md
├─ TECHNICAL.md
├─ assets/
│  ├─ css/
│  │  ├─ styles.css
│  │  ├─ glass-cards.css
│  │  ├─ exercise-card.css
│  │  ├─ page-unification.css
│  │  ├─ planning.css
│  │  ├─ training-motion.css
│  │  └─ nav-motion.css
│  └─ icons/
│     ├─ icon-192.png
│     ├─ icon-192-maskable.png
│     ├─ icon-512.png
│     └─ icon-512-maskable.png
└─ js/
   ├─ core/
   │  ├─ app-storage.js
   │  ├─ app.js
   │  ├─ app-body.js
   │  └─ app-backup.js
   ├─ training/
   │  ├─ training-progression.js
   │  ├─ training-next-workout.js
   │  ├─ training-draft.js
   │  ├─ training-render.js
   │  ├─ training-insights.js
   │  ├─ training-maintenance.js
   │  ├─ training.js
   │  ├─ planning.js
   │  ├─ training-motion.js
   │  └─ training-keyboard-viewport.js
   ├─ sync/
   │  ├─ sync-remote.js
   │  └─ sync.js
   ├─ ui/
   │  └─ nav-motion.js
   └─ pwa/
      └─ sw-register.js
```

`sw.js` 位于根目录，使 Service Worker 默认 scope 覆盖整个应用。`manifest.webmanifest` 也保留在根目录，因此 `start_url: ./` 和 `scope: ./` 对应 GitHub Pages 项目根路径。

## 3. 模块职责

### 根目录入口

- `index.html`：页面结构、CSP、CSS/JS 加载入口
- `manifest.webmanifest`：PWA 名称、图标、启动地址和 display 配置
- `sw.js`：静态 shell 缓存、离线导航、旧缓存清理
- `rescue.html`：注销 Service Worker 并清理静态缓存，不操作 IndexedDB

### `assets/css`

- `styles.css`：基础布局和通用组件
- `glass-cards.css`：卡片视觉层级和玻璃效果
- `exercise-card.css`：训练动作卡片和组输入布局
- `page-unification.css`：各页面共用的版式统一层
- `planning.css`：计划页和模板编辑样式
- `training-motion.css`：训练页滚动吸附相关样式
- `nav-motion.css`：底部导航运动和液体玻璃相关样式

### `js/core`

- `app-storage.js`：IndexedDB 打开、KV 读写和主状态读写
- `app.js`：应用状态、启动流程、路由、模块生命周期和持久化协调
- `app-body.js`：身体数据录入和历史渲染
- `app-backup.js`：本地 JSON 导出、导入和本机数据清理

核心层只公开跨模块确实需要的能力。身体数据和备份模块通过 `FitnessApp.registerModule()` 参与生命周期，不额外挂载全局业务 API。

### `js/training`

- `training-progression.js`：历史上下文、次数区间、重量档位和进阶建议
- `training-next-workout.js`：全局唯一当前待训练计划的选择、归一化和替换
- `training-draft.js`：未保存训练输入、完成状态和本次临时组数
- `training-render.js`：训练页动作卡和组输入渲染
- `training-insights.js`：历史记录、趋势区间和图表
- `training-maintenance.js`：旧重复训练记录识别与清理
- `training.js`：训练页事件、训练保存和流程协调
- `planning.js`：候选计划生成/编辑/推送，以及训练模板编辑
- `training-motion.js`：训练页卡片吸附、手势来源判断和顶/底栏交互
- `training-keyboard-viewport.js`：Android 软键盘 viewport 恢复检测，结束编辑保护后通知 motion 重建状态

`training-motion.js` 和 `training-keyboard-viewport.js` 当前仍分开保留。前者属于高敏感交互代码；键盘兼容逻辑在真机验证充分前不与主 motion 文件合并。

### `js/sync`

- `sync-remote.js`：GitHub API、Base64、SHA-256、远端格式校验和文件读写
- `sync.js`：凭据、本机同步元数据、push/pull、自动检查、页面同步交互和计划冲突

自动检查已经并入 `sync.js`，不再维护单独的自动同步脚本。训练记录和身体记录共用同一套 immutable push/pull 辅助流程。

### `js/ui` 与 `js/pwa`

- `js/ui/nav-motion.js`：底部导航选中状态和动画
- `js/pwa/sw-register.js`：尽早注册根目录 `sw.js`

## 4. 脚本加载顺序

`index.html` 保持依赖顺序：

```text
js/pwa/sw-register.js
js/core/app-storage.js
js/core/app.js
js/core/app-body.js
js/core/app-backup.js
js/training/training-progression.js
js/training/training-next-workout.js
js/training/training-draft.js
js/training/training-render.js
js/training/training-insights.js
js/training/training-maintenance.js
js/training/training.js
js/training/planning.js
js/training/training-motion.js
js/training/training-keyboard-viewport.js
js/ui/nav-motion.js
js/sync/sync-remote.js
js/sync/sync.js
```

底层模块先向 `window` 注册能力，上层模块读取依赖并向 `FitnessApp` 注册生命周期函数。

`app.js` 负责统一启动和跨模块状态协调。导入或清空训练数据统一经过 `FitnessApp.resetData()`。

## 5. 训练数据模型

### 训练模板

模板位于 `plans[]`。单个动作通常包含：

```text
name
sets
repRange
defaultWeight
weightStep
note
optional
```

专项热身动作还可包含：

```text
warmup
setPresets
```

模板只负责以后如何生成候选计划。

### 当前待训练计划

当前待训练计划保存在对应模板的 `plannedWorkout` 中。全局只允许一个 `status: confirmed` 的待训练计划。

主要字段：

```text
id
revision
status
planName
generatedAt
confirmedAt
exercises
```

计划页可以生成和修改候选快照；只有点击“推送训练计划”才写入 `plannedWorkout` 并替换之前的待训练计划。训练已经产生实际输入时禁止替换。

### 训练记录

每次保存训练时生成 UUID，写入 `sessions[]`。记录包含：

```text
id
date
plan
plannedWorkoutId
plannedRevision
exercises
```

每组包含：

```text
weight
reps
rir
completed
```

正式动作还保存本次计划快照，便于之后判断计划重量与实际重量是否不同。

### 身体数据

单条记录包含：

```text
id
date
weight
chest
waist
arm
```

## 6. IndexedDB

数据库配置：

```text
DB_NAME: fitness-pwa-db
DB_VERSION: 1
Object Store: kv
```

主状态键：

```text
plans
sessions
body
```

其他当前使用键：

```text
workoutDraftsV8
workoutActivePlanV7
syncCredentialsV7
syncConfig            # 旧凭据结构兼容，仅 owner/repo
syncMetaV11
```

`training-draft.js` 仍读取旧 `workoutDraftsV7` 作为迁移兼容入口。兼容键删除前需要先确认所有常用设备都已运行过新版本并完成迁移。

## 7. 本地备份

导出格式：

```text
fitness-pwa-backup-v3
```

主要字段：

```text
exportedAt
plans
sessions
body
```

文件名：

```text
fitness-backup-YYYY-MM-DD.json
```

同步凭据和未保存训练草稿不进入训练备份。

## 8. GitHub 远端数据协议

Private 数据仓库结构：

```text
manifest.json
plans.json
sessions/<sha256(session-id)>.json
body/<sha256(record-id)>.json
```

格式标识：

```text
manifest: fitness-pwa-manifest-v3
plans: fitness-plans-v3
session: fitness-session-v2
body entry: fitness-body-entry-v2
```

训练记录和身体记录使用本地 UUID 的 SHA-256 作为远端文件名。下载时重新计算哈希并校验记录 ID。

训练模板和当前待训练计划一起保存在 `plans.json`，每次更新生成新的随机 revision。

## 9. 增量同步

### Push

主要流程：

1. 检查同步目标仓库权限和 Private 状态
2. 为缺少 UUID 的旧训练/身体记录补 ID
3. 更新本地计划同步元数据
4. 下载 `manifest.json`
5. 上传远端缺少的 immutable 训练记录和身体记录
6. 必要时更新 `plans.json`
7. 更新 `manifest.json`

### Pull

主要流程：

1. 保存当前训练草稿
2. 检查同步目标并读取远端 manifest
3. 判断 `plans.json` revision 是否变化
4. 下载本机缺少的训练和身体记录
5. 必要时使用远端计划集合
6. 清理旧重复训练记录
7. 写入 IndexedDB 并刷新界面

### 自动检查

`sync.js` 在初始化完成且当前页面为训练页时安排一次检查；之后进入训练页时按 60 秒冷却时间判断是否再次检查。存在未保存训练输入时跳过自动拉取。

自动检查必须等同步模块完成凭据恢复后才能执行，避免页面生命周期早于同步初始化时使用空表单配置。

## 10. 训练计划冲突

本机维护：

```text
plansBaseRevision
plansDirty
plansSig
```

- `plansBaseRevision`：本机最后确认的远端 revision
- `plansDirty`：该 revision 之后本机 plans 是否修改
- `plansSig`：当前 plans JSON 的 SHA-256 签名

云端和本机同时修改计划时，直接 push 会被阻止；pull 时由用户明确确认是否使用 GitHub 最新计划。训练历史和身体数据继续按集合方式合并。

## 11. PWA 与 Service Worker

`manifest.webmanifest`：

```text
display: standalone
start_url: ./
scope: ./
```

`js/pwa/sw-register.js` 注册 `./sw.js`。由于 `sw.js` 位于根目录，默认 scope 覆盖整个应用。

`sw.js` 安装时缓存静态 shell，激活时删除旧的 `fitness-pwa-*` 缓存。导航请求优先返回缓存中的 `index.html`，其他同源 GET 使用 cache-first。GitHub API 为跨域请求，不进入静态 shell 缓存。

## 12. 静态资源版本

当前 shell 缓存名：

```text
fitness-pwa-shell-v98
```

各 CSS/JS 文件的 `?v=` 参数独立变化，只在文件内容实际修改时更新。发布时必须保证：

1. `index.html` 中被修改资源的 `?v=` 已更新
2. `sw.js` 的 `SHELL_ASSETS` 使用完全相同的资源 URL
3. `SHELL_CACHE` 更新到新的发布版本
4. 删除脚本后同时从 `index.html` 和 `SHELL_ASSETS` 删除引用

## 13. 发布检查

项目没有 npm、打包器或编译步骤。每次发布至少检查：

- 首页能正常加载全部 CSS 和 JavaScript
- PWA manifest 和图标正常
- Service Worker 成功安装新 shell cache
- IndexedDB 旧数据可以读取
- 当前待训练计划能恢复
- 未保存训练草稿刷新后能恢复
- 计划页可生成、编辑并推送候选计划
- 训练页可输入、临时增减组数和保存训练
- 保存训练后历史和趋势更新
- Android 软键盘关闭后训练卡片吸附仍可继续
- 身体数据可以保存
- 本地 JSON 导入导出正常
- GitHub pull/push 正常
- 自动同步不会在同步模块初始化前执行
- 双设备 plans 修改会触发 revision 冲突
- `rescue.html` 只清理静态缓存

## 14. 后续维护原则

- 根目录只保留页面/PWA 入口和项目文档
- 样式统一放入 `assets/css`
- 核心状态和生命周期放入 `js/core`
- 训练业务放入 `js/training`
- GitHub HTTP 与远端格式集中在 `js/sync/sync-remote.js`
- 同步流程、凭据和自动检查集中在 `js/sync/sync.js`
- 独立 UI 行为放入 `js/ui`
- PWA 注册辅助代码放入 `js/pwa`
- 不为了减少文件数量合并职责清晰的模块
- 删除公开 API 前先确认没有跨模块调用者
- `training-motion.js`、`training-motion.css` 和 `nav-motion.js` 属于高回归风险区域，整理时保持小范围、可回退修改
