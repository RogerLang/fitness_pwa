# 训练记录 PWA v2

纯静态、local-first 的训练记录 PWA。

## 隐私设计
- GitHub Pages 公开仓库只保存程序文件。
- 训练计划、训练历史和身体数据默认只保存在当前设备 IndexedDB。
- 无 Analytics、广告、第三方 SDK 或第三方云数据库。
- 可选的跨设备同步使用 **单独的 Private GitHub repository**。
- 同步前，浏览器用 Web Crypto API 的 **PBKDF2-SHA-256 + AES-256-GCM** 加密整个数据包；Private repo 里只写入密文。
- 同步密码不上传，也不写入公开仓库。
- Fine-grained GitHub token 不上传；页面刷新后需要重新输入。
- 应用上传前会查询目标仓库并拒绝向非 Private 仓库同步。

## v2 新功能
- 网页内新建/删除训练计划。
- 网页内增加/删除动作。
- 可直接修改动作名称、组数、rep range、默认重量、加重量步长、备注。
- 多设备手动加密同步：上传/拉取。
- 继续支持本地 JSON 导入导出。

## 推荐同步仓库设置
新建一个 **Private** repository，例如 `fitness-data-private`。
创建 Fine-grained personal access token，只授权这个仓库，并只授予：
- Contents: Read and write
- Metadata: Read（GitHub 自动需要）

不要给 token 额外仓库权限。

## 冲突策略
v2 使用手动 Push / Pull：
- 在一台设备训练或编辑完后点“加密并上传”。
- 换设备前点“从云端拉取并解密”。
- Pull 会覆盖当前本机数据，因此操作前会确认。

这种方式简单，也减少自动后台同步产生的覆盖风险。
