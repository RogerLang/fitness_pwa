# 训练记录 PWA

纯静态、local-first 的个人训练记录 PWA。

## 隐私设计
- GitHub Pages 公开仓库只保存程序文件。
- 训练计划、训练历史和身体数据默认保存在当前设备 IndexedDB。
- 无 Analytics、广告或第三方统计 SDK。
- 可选跨设备同步使用一个单独的 **Private GitHub repository**。
- 同步内容先在浏览器内使用 **PBKDF2-SHA-256 + AES-256-GCM** 加密，再调用 GitHub API 上传。
- Fine-grained token 和同步密码不会写入公开仓库，也不会上传到同步仓库；页面刷新后需要重新输入。
- 上传前会检查同步目标必须是 Private repository。

## 增量同步结构
Private 数据仓库使用以下结构：

```text
manifest.enc.json
plans.enc.json
sessions/<sha256(random-session-id)>.enc.json
body/<sha256(record-id)>.enc.json
```

- `manifest.enc.json` 本身也是密文。
- 每次训练记录单独加密，只新增缺少的训练文件，不反复重写全部历史。
- 每条身体记录同样独立加密并增量合并。
- 训练计划保存在一个小型加密文件中，并使用 revision 检测多设备计划冲突。
- 文件名不直接包含训练日期、动作、体重或围度。
- GitHub 仍可观察仓库级元数据，例如文件数量、文件大小和提交时间。

## 三设备使用逻辑
推荐每台新设备第一次使用时先点 **“从云端合并”**，之后正常流程是：

1. 训练或修改计划。
2. 点 **“增量加密同步”**。
3. 换到另一台设备后先点 **“从云端合并”**。

训练记录和身体记录采用集合合并，不会因为另一台设备新增记录而覆盖本机历史。

训练计划属于可编辑配置。如果两台设备都在上一次同步之后修改过计划，应用会识别 revision 冲突并阻止静默覆盖；从云端合并时会要求用户明确选择是否使用云端计划。

## 推荐 Private 仓库权限
创建 Fine-grained personal access token，只授权同步数据仓库，并只授予：
- Contents: Read and write
- Metadata: Read

不要给 token 额外仓库权限。

## 本地备份
仍支持导出/导入明文 JSON。明文备份请只保存在你自己控制的设备或加密存储中。
