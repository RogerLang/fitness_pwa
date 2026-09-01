# 训练记录 PWA

这是一个纯静态、local-first 的个人训练记录 PWA。

## 隐私设计
- GitHub Pages 上只部署 HTML/CSS/JS/PWA 图标。
- 训练记录、身体数据、计划保存在当前设备的 IndexedDB。
- 无 Google Analytics、无广告、无第三方 SDK、无云数据库。
- 默认不向外部服务上传训练数据。
- 备份需要你手动“导出 JSON”。

## GitHub Pages 部署
1. 新建一个 GitHub repository，例如 `fitness-pwa`。
2. 把本 zip 中的文件上传到仓库根目录。
3. GitHub 仓库：Settings → Pages。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，Folder 选择 `/ (root)`。
6. 保存后等待 Pages 地址出现。
7. 打开网页，在“设置”里导入你自己的 starter JSON。
8. iPhone Safari：分享 → 添加到主屏幕。
   Android Chrome：菜单 → 安装应用/添加到主屏幕。

## 本地测试
Service Worker 需要 HTTP(S)，不要直接双击 `index.html` 测 PWA 离线能力。
可以在目录中运行：

    python3 -m http.server 8000

然后访问：

    http://localhost:8000

## 更新
如果修改了静态文件，建议同时把 `sw.js` 里的 CACHE 名称从
`fitness-pwa-v1` 改为 `fitness-pwa-v2`，避免旧缓存长期保留。
