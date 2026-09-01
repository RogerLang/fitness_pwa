# 训练记录 PWA

纯静态、local-first 的个人训练记录 PWA。

## 数据与同步
- GitHub Pages 公开仓库只保存程序文件。
- 训练计划、训练历史和身体数据默认保存在当前设备 IndexedDB。
- 无 Analytics、广告或第三方统计 SDK。
- 可选跨设备同步使用一个单独的 **Private GitHub repository**。
- 同步数据在 Private 仓库中以普通 JSON 保存；任何能访问该 Private 仓库的人都可以读取内容。
- Fine-grained token 可保存在当前浏览器 IndexedDB 中，不会提交到公开程序仓库，也不会写入训练数据文件。
- 上传前会强制检查同步目标必须是 Private repository。

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
