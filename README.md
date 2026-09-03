# 练了么（Fitness PWA）

`fitness_pwa` 是一个个人力量训练记录 PWA，用于记录每组重量、次数和 RIR，维护训练计划，查看历史与趋势，并记录体重和围度数据。

应用采用 local-first 设计。训练计划、训练历史、身体数据和训练草稿默认保存在当前浏览器 IndexedDB；需要跨设备使用时，可选同步到单独的 Private GitHub repository。

## 主要功能

- 记录重量、次数、RIR 和每组完成状态
- 在训练页维护动作、组数、次数区间、默认重量和重量档位
- 自动保存未完成的训练草稿
- 查看训练历史和动作趋势
- 记录体重、胸围、腰围和臂围
- 导入 / 导出本地 JSON 备份
- 可选 Private GitHub 多设备增量同步
- PWA 安装与离线静态资源缓存

## 部署

项目由原生 HTML、CSS 和 JavaScript 组成，没有构建步骤。推荐直接使用 GitHub Pages：

1. Fork 或复制本仓库。
2. 保留当前目录结构。
3. 在 Pages 设置中选择从 `main` 分支根目录发布。
4. 使用生成的 HTTPS 地址打开应用。

根目录保留 `index.html`、`manifest.webmanifest`、`sw.js` 和 `rescue.html` 等入口文件；样式、图标和 JavaScript 已按职责放入子目录。

## 第一次使用

全新浏览器中没有训练计划时，可以通过两种方式初始化：

1. 已有其他设备数据：完成 GitHub 同步配置后点击“从 GitHub 合并”。
2. 已有本地备份：在“设置 → 本地备份”中导入 `fitness-backup-*.json`。

训练计划加载后，可以直接在训练页继续调整动作配置。

## Private GitHub 同步配置

建议单独创建一个 Private repository 作为训练数据仓库，例如 `fitness-data-private`。为该数据仓库创建 Fine-grained personal access token，并仅授予同步所需的仓库内容读写权限。

在“设置 → GitHub 同步”中填写：

- GitHub 用户名
- Private 仓库名
- Fine-grained token

点击“保存本机同步信息”后，配置保存在当前浏览器。应用会在同步前检查目标仓库必须为 Private repository。

如果当前设备已有完整数据，第一次点击“增量同步”会创建远端数据结构；新设备第一次使用时点击“从 GitHub 合并”。

## 多设备使用

推荐顺序：

1. 切换设备后先从 GitHub 合并最新数据。
2. 正常训练并保存记录。
3. 训练完成后执行增量同步。
4. 下一台设备使用前再次拉取。

训练记录和身体记录按条目合并。训练计划使用 revision 检测多设备修改冲突，发生冲突时应用会阻止直接覆盖并要求先处理计划版本。

## 本地备份

“设置 → 本地备份”支持导出明文 JSON、导入备份以及清理当前设备训练数据。修改训练计划、迁移设备或调整同步配置前，可以先导出一份备份。

## PWA 与缓存恢复

在支持 PWA 的浏览器中，可通过页面安装按钮或浏览器菜单添加到桌面/主屏幕。Service Worker 会缓存应用静态资源，GitHub 同步仍需要网络连接。

发布后若遇到旧缓存导致的启动异常，可访问：

```text
rescue.html
```

该页面只清理 Service Worker 和静态缓存，不删除 IndexedDB 中的训练数据。

## 技术文档

项目目录、模块职责、本地存储、同步协议、Service Worker 和发布约定见 [TECHNICAL.md](./TECHNICAL.md)。
