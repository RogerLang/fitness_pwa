# 训练记录 PWA

纯静态、local-first 的个人训练记录 PWA。

## 代码结构

当前前端保持无构建工具的静态结构，功能按职责拆分：

- `index.html`：页面结构和静态资源入口，不放业务逻辑。
- `styles.css`：基础布局、通用组件和移动端基础样式。
- `glass-cards.css`：液体玻璃视觉系统、页面视觉层级和与视觉直接相关的小尺寸调整。
- `training-motion.css`：训练页滚动吸附、高亮和编辑状态对应的样式。
- `nav-motion.css`：底部导航栏隐藏/出现与滑动玻璃胶囊样式。
- `app-storage.js`：IndexedDB 打开、KV 读写，以及 plans / sessions / body 三类主状态的批量读取和写入。
- `app.js`：应用状态、启动流程、页面路由、模块生命周期和跨模块数据重置协调；通过 `app-storage.js` 使用 IndexedDB。
- `app-body.js`：身体数据输入、保存和最近身体记录渲染。
- `app-backup.js`：本地 JSON 导出、导入和本机训练数据清空。
- `training-progression.js`：训练次数区间、重量档位、历史上下文、进阶建议和上次记录摘要。
- `training-draft.js`：训练草稿、当前计划索引、组输入值、完成状态以及草稿 IndexedDB 持久化。
- `training-render.js`：计划选择器、动作卡 HTML、动作编辑器展开状态和训练页渲染。
- `training-insights.js`：历史记录页、趋势页、趋势时间范围状态和图表绘制。
- `training-maintenance.js`：重复训练记录识别与维护清理。
- `training.js`：训练页事件、计划编辑、训练保存以及各训练模块之间的流程协调。
- `training-motion.js`：训练页滚动吸附、快速滑动、卡片定位以及输入编辑时的吸附保护。
- `nav-motion.js`：底部导航选中胶囊的位置和动画状态。
- `sync-remote.js`：GitHub API 请求、Base64 编解码、SHA-256、manifest 与远端记录格式校验，以及远端文件读写。
- `sync.js`：本机与远端同步流程、计划冲突处理、同步凭据、本机元数据和同步按钮交互。
- `sw-register.js`：尽早注册 Service Worker，使缓存更新独立于应用业务初始化。
- `sw.js`：静态 shell 缓存、离线回退和旧缓存清理。
- `rescue.html`：只清理 Service Worker 和静态缓存的恢复入口，不删除 IndexedDB 数据。

基础应用按 `sw-register.js` → `app-storage.js` → `app.js` → `app-body.js` / `app-backup.js` 加载。训练模块按依赖顺序加载：`training-progression.js` → `training-draft.js` → `training-render.js` → `training-insights.js` / `training-maintenance.js` → `training.js` → `training-motion.js`。同步模块按 `sync-remote.js` → `sync.js` 加载。

`app.js` 保留跨模块生命周期协调。导入或清空数据统一经过 `FitnessApp.resetData()`，由核心依次完成数据替换、持久化、模块重置钩子和页面刷新。身体数据模块、备份模块、训练模块和同步模块不需要直接访问彼此的内部状态。

远端协议、GitHub HTTP 与文件完整性校验留在 `sync-remote.js`；同步业务状态和页面交互留在 `sync.js`。已经验证并长期保留的功能应优先回收到对应正式模块中，避免新增只包含少量覆盖规则的临时补丁文件。每次发布统一使用同一个静态资源查询版本号，并同步更新 `SHELL_CACHE`，减少多文件版本混用。

## 数据与同步
- GitHub Pages 公开仓库只保存程序文件。
- 训练计划、训练历史和身体数据默认保存在当前设备 IndexedDB。
- 无 Analytics、广告或第三方统计 SDK。
- 可选跨设备同步使用一个单独的 **Private GitHub repository**。
- 同步数据在 Private 仓库中以普通 JSON 保存；任何能访问该 Private 仓库的人都可以读取内容。
- Fine-grained token 可保存在当前浏览器 IndexedDB 中，不会提交到公开程序仓库，也不会写入训练数据文件。
- 上传前会强制检查同步目标必须为 Private repository。

## 增量同步结构
Private 数据仓库使用以下结构：

```text
manifest.json
plans.json
sessions/<sha256(random-session-id)>.json
body/<sha256(record-id)>.json
```

- 每次训练记录单独保存，只新增缺少的训练文件，不反复重写全部历史。
- 每条身体记录同样独立保存并增量合并。
- 训练计划保存在一个小型 JSON 文件中，并使用 revision 检测多设备计划冲突。
- 文件名不直接包含训练日期；记录内容本身为可读 JSON。
- 旧版 `*.enc.json` 加密文件可保留作为迁移期备份，新版同步不会读取或覆盖它们。

## 多设备使用逻辑
第一台有完整数据的设备先点 **“增量同步”**。其他设备第一次使用新版时点 **“从 GitHub 合并”**。之后正常流程是：

1. 训练或修改计划。
2. 点 **“增量同步”**。
3. 换到另一台设备后先点 **“从 GitHub 合并”**。

训练记录和身体记录采用集合合并，不会因为另一台设备新增记录而覆盖本机历史。

训练计划属于可编辑配置。如果两台设备都在上一次同步之后修改过计划，应用会识别 revision 冲突并阻止静默覆盖；从 GitHub 合并时会要求用户明确选择是否使用 GitHub 上的计划。

## 推荐 Private 仓库权限
创建 Fine-grained personal access token，只授权同步数据仓库，并只授予：
- Contents: Read and write
- Metadata: Read

不要给 token 额外仓库权限。

## 本地备份与训练草稿
仍支持导出/导入明文 JSON。训练中的重量、次数、RIR 和每组完成状态会自动保存到当前浏览器，并在页面刷新或浏览器重启后恢复。
