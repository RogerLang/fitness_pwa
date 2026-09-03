# 练了么：技术文档

本文记录 `fitness_pwa` 当前的目录结构、模块职责、本地数据、PWA 缓存和 GitHub 同步实现。日常使用与配置见 [README.md](./README.md)。

## 1. 总体架构

`fitness_pwa` 是一个无构建步骤的纯静态 PWA，由 HTML、CSS 和原生 JavaScript 组成。

主要设计：

- local-first：训练数据优先保存到浏览器 IndexedDB
- 模块化：核心状态、训练逻辑、同步、界面交互分别维护
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
   │  ├─ training-draft.js
   │  ├─ training-render.js
   │  ├─ training-insights.js
   │  ├─ training-maintenance.js
   │  ├─ training.js
   │  └─ training-motion.js
   ├─ sync/
   │  ├─ sync-remote.js
   │  └─ sync.js
   ├─ ui/
   │  └─ nav-motion.js
   └─ pwa/
      └─ sw-register.js
```

`sw.js` 保留在根目录，使 Service Worker 默认 scope 覆盖整个应用。`manifest.webmanifest` 也保留在根目录，因此 `start_url: ./` 和 `scope: ./` 继续对应 GitHub Pages 项目根路径。

## 3. 模块职责

### 根目录入口

- `index.html`：页面结构、CSP、CSS/JS 加载入口
- `manifest.webmanifest`：PWA 名称、图标、启动地址和 display 配置
- `sw.js`：静态 shell 缓存、离线导航、旧缓存清理
- `rescue.html`：注销 Service Worker 并清理应用静态缓存，不操作 IndexedDB

### `assets/css`

- `styles.css`：基础布局、通用组件和移动端样式
- `glass-cards.css`：卡片视觉层级和玻璃效果
- `training-motion.css`：训练页滚动吸附和编辑相关样式
- `nav-motion.css`：底部导航运动效果

### `js/core`

- `app-storage.js`：IndexedDB 打开、KV 读写和主状态读写
- `app.js`：应用状态、启动流程、页面切换、模块生命周期和持久化协调
- `app-body.js`：身体数据录入、保存和历史渲染
- `app-backup.js`：本地 JSON 导出、导入和本机数据清理

### `js/training`

- `training-progression.js`：历史上下文、次数区间、重量档位和进阶建议
- `training-draft.js`：训练草稿、当前计划索引、组输入值和完成状态
- `training-render.js`：计划选择器、动作卡和动作编辑器渲染
- `training-insights.js`：历史记录、趋势区间和图表
- `training-maintenance.js`：重复训练记录识别与清理
- `training.js`：训练页事件、计划调整、训练保存和流程协调
- `training-motion.js`：训练页滚动吸附、快速滑动和卡片定位交互

### `js/sync`

- `sync-remote.js`：GitHub API、Base64、SHA-256、远端格式校验和文件读写
- `sync.js`：push/pull 流程、计划冲突、本机同步元数据和页面交互

### `js/ui` 与 `js/pwa`

- `js/ui/nav-motion.js`：底部导航选中状态和动画
- `js/pwa/sw-register.js`：尽早注册根目录 `sw.js`

## 4. 脚本加载顺序

`index.html` 保持以下依赖顺序：

```text
js/pwa/sw-register.js
js/core/app-storage.js
js/core/app.js
js/core/app-body.js
js/core/app-backup.js
js/training/training-progression.js
js/training/training-draft.js
js/training/training-render.js
js/training/training-insights.js
js/training/training-maintenance.js
js/training/training.js
js/training/training-motion.js
js/ui/nav-motion.js
js/sync/sync-remote.js
js/sync/sync.js
```

底层模块先向 `window` 注册能力，上层模块读取依赖并向 `FitnessApp` 注册生命周期函数。

`app.js` 负责统一启动和跨模块状态协调。导入或清空训练数据统一经过 `FitnessApp.resetData()`。

## 5. IndexedDB

数据库配置：

```text
DB_NAME: fitness-pwa-db
DB_VERSION: 1
Object Store: kv
```

主状态：

```text
plans
sessions
body
```

训练草稿、同步配置和同步元数据也保存在 IndexedDB 中。

### 训练计划

计划结构示例：

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

动作还可包含 `warmup`、`setPresets` 等字段。

### 训练记录

每次保存训练时生成随机 UUID。记录包含日期、计划名称、动作以及各组：

```text
weight
reps
rir
completed
```

正式动作还会保存当次进阶建议快照。

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

## 6. 本地备份

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

同步凭据不进入训练备份。

## 7. GitHub 远端数据协议

Private 数据仓库结构：

```text
manifest.json
plans.json
sessions/<sha256(session-id)>.json
body/<sha256(record-id)>.json
```

当前格式标识：

```text
manifest: fitness-pwa-manifest-v3
plans: fitness-plans-v3
session: fitness-session-v2
body entry: fitness-body-entry-v2
```

训练记录和身体记录使用本地 UUID 的 SHA-256 作为远端文件名。下载时重新计算哈希并校验记录 ID。

训练计划保存在 `plans.json`，每次更新生成新的随机 revision。

## 8. 增量同步

### Push

主要流程：

1. 检查同步目标仓库权限和可用性
2. 确保本地旧记录具有 UUID
3. 读取本地计划同步元数据
4. 下载 `manifest.json`
5. 计算训练记录和身体记录哈希
6. 上传远端缺少的独立条目
7. 必要时更新 `plans.json`
8. 更新 `manifest.json`

已存在的条目文件会经过格式和记录 ID 校验。

### Pull

主要流程：

1. 保存当前训练草稿
2. 读取远端 manifest
3. 判断训练计划 revision 是否变化
4. 下载本机缺少的训练和身体记录
5. 合并历史数据
6. 必要时处理训练计划版本
7. 清理旧重复记录
8. 写入 IndexedDB 并刷新界面

## 9. 训练计划冲突

本机维护三个关键字段：

```text
plansBaseRevision
plansDirty
plansSig
```

- `plansBaseRevision`：本机最后确认的远端 revision
- `plansDirty`：该 revision 之后本机计划是否修改
- `plansSig`：当前 plans JSON 的 SHA-256 签名

云端和本机同时修改计划时，直接 push 会被阻止；pull 时由用户明确选择计划版本。训练历史和身体数据继续按集合方式合并。

## 10. PWA 与 Service Worker

`manifest.webmanifest`：

```text
display: standalone
start_url: ./
scope: ./
```

`js/pwa/sw-register.js` 从页面注册 `./sw.js`。由于 `sw.js` 位于根目录，默认 scope 可以覆盖根目录及所有子目录中的资源。

`sw.js` 安装时缓存静态 shell，激活时删除旧的 `fitness-pwa-*` 缓存。导航请求优先返回缓存中的 `index.html`，其他同源 GET 使用 cache-first。GitHub API 为跨域请求，不进入该静态缓存流程。

## 11. 静态资源版本

当前静态资源版本为：

```text
v68
```

发布新版本时同步修改：

1. `index.html` 中 CSS/JS 的 `?v=` 参数
2. `sw.js` 中 `SHELL_ASSETS` 的对应路径和 `?v=` 参数
3. `sw.js` 中 `SHELL_CACHE` 名称

目录调整时也需要同时检查 `manifest.webmanifest` 中的图标路径。

## 12. 发布检查

项目没有 npm、打包器或编译步骤。修改后可通过静态 HTTP 服务测试。

每次发布至少检查：

- 首页是否能正常加载全部 CSS 和 JavaScript
- PWA 图标和 manifest 是否返回成功
- Service Worker 是否成功安装新的 shell cache
- IndexedDB 旧数据是否可以读取
- 训练草稿刷新后是否恢复
- 保存训练后历史和趋势是否更新
- 身体数据是否可以保存
- 本地 JSON 导入导出是否正常
- GitHub pull/push 是否正常
- 双设备计划修改是否触发 revision 冲突
- `rescue.html` 是否只清理静态缓存

## 13. 后续维护原则

- 根目录只保留页面/PWA 入口和项目文档
- 样式统一放入 `assets/css`
- 图标统一放入 `assets/icons`
- 核心应用模块放入 `js/core`
- 训练业务模块放入 `js/training`
- GitHub 同步模块放入 `js/sync`
- 独立 UI 行为放入 `js/ui`
- PWA 注册辅助代码放入 `js/pwa`
- `app.js` 继续只负责核心状态和跨模块生命周期
- GitHub HTTP、远端格式与完整性校验继续集中在 `js/sync/sync-remote.js`
- 同步交互和计划冲突继续集中在 `js/sync/sync.js`
