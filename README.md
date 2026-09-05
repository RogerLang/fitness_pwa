# 练了么 / Lianleme

一个为个人力量训练设计的简洁 PWA，用来制定下一次训练、记录真实训练数据，并持续查看自己的训练历史和进步。

A lightweight PWA for personal strength training: plan your next workout, record what you actually did, and review your training history and progress over time.

[中文](#中文) · [English](#english)

---

# 中文

## 能做什么

- 根据训练模板和历史记录生成下一次训练建议
- 调整本次训练的重量、次数和组数，再推送为当前待训练计划
- 在训练中记录每组重量、次数、RIR 和完成状态
- 临时增加或减少本次训练组数，不影响长期模板
- 自动保存训练中的未完成输入，刷新后继续
- 查看训练历史和动作趋势
- 记录体重、胸围、腰围和臂围
- 通过 ChatGPT 提出训练模板修改，并在计划页确认后应用
- 可选使用 Private GitHub 仓库在多台设备之间同步训练数据
- 导入和导出本地 JSON 备份
- 可安装为 PWA，并支持应用静态资源离线使用

## 基本使用流程

1. 打开 **计划** 页面，选择训练模板。
2. 查看系统根据历史记录生成的下一次训练建议。
3. 根据当天状态调整重量、次数或组数。
4. 点击 **推送计划**，把这份计划设为当前待训练计划。
5. 打开 **训练** 页面，按计划训练并填写实际完成的数据。
6. 点击保存后，本次训练会进入 **历史**，并用于以后生成新的训练建议。

可以同时编辑其他模板的下一次训练建议，但全局只会保留一份“当前待训练计划”。再次推送新的计划会直接替换之前的待训练计划。

## 计划与模板

### 重新生成训练建议

在计划页点击 **重新生成**，会按照当前训练模板和最新训练历史重新计算本次建议。

如果你已经手动调整过本次计划，而训练历史或模板发生了变化，应用会提示你选择：

- 保留当前调整
- 按最新数据重新生成

### 修改训练模板

训练模板代表长期训练规则。修改模板只影响以后生成的新建议，不会改变已经推送的当前待训练计划。

如果通过 ChatGPT 生成了模板修改提议，计划页会显示待确认内容。点击 **确认修改** 后，模板会立即更新，并自动重新生成对应的下一次训练建议。

## 训练记录

在训练页可以记录：

- 重量
- 次数
- RIR
- 每组完成状态
- 本次临时增加或减少的组数

训练中的输入会自动保存在当前设备。即使刷新页面或重新打开应用，也可以继续填写未完成的训练。

保存训练后，实际完成的数据会进入历史记录；当前待训练计划会被视为已完成并清空。

## 历史、趋势和身体数据

**历史** 页面用于查看已经完成的训练记录。

**趋势** 页面用于查看动作表现随时间的变化。

还可以记录：

- 体重
- 胸围
- 腰围
- 臂围

这些数据可以和训练记录一起保存和同步。

## Private GitHub 多设备同步

如果只在一台设备上使用，可以完全不配置 GitHub 同步。

如果需要手机和电脑之间同步，建议单独创建一个 **Private GitHub repository** 作为训练数据仓库。

### 配置方法

1. 新建一个 Private GitHub repository。
2. 创建一个 Fine-grained personal access token，只给这个私有仓库必要的 Contents 读写权限。
3. 打开应用的 **设置 → GitHub 同步**。
4. 填写 GitHub 用户名、Private 仓库名和 token。
5. 保存同步信息。

同步信息只需要在每台设备上分别配置一次。

### 新设备使用

在一台新设备上：

1. 配置同一个 Private GitHub 仓库。
2. 从 GitHub 合并最新数据。
3. 确认计划和历史记录正常后开始使用。

日常使用时，应用会尽量避免静默覆盖其他设备上的较新修改；如果检测到需要人工处理的冲突，会直接提示。

## 本地备份

在 **设置 → 本地备份** 中可以：

- 导出 JSON 备份
- 导入以前的 JSON 备份
- 清理当前设备上的训练数据

如果准备迁移设备、进行较大的训练模板调整，或者只是希望保留一个额外副本，可以先导出备份。

GitHub 同步凭据不会包含在训练数据备份中。

## 安装为 App

练了么是一个 PWA。在支持 PWA 的浏览器中，可以通过浏览器菜单或页面提供的安装入口把它添加到桌面或手机主屏幕。

安装后可以像普通 App 一样打开。应用界面和已缓存的静态资源可以离线加载，但 GitHub 同步需要网络连接。

## 更新异常时

如果应用更新后出现明显的旧页面或缓存异常，可以打开：

```text
rescue.html
```

它会清理应用的 Service Worker 和静态缓存，然后重新加载最新版本；不会删除已经保存在浏览器中的训练数据。

---

# English

## What it does

- Generates your next workout from a training template and previous sessions
- Lets you adjust weight, reps, and sets before making a workout your active plan
- Records weight, reps, RIR, and completion status for each set
- Lets you temporarily add or remove sets without changing the long-term template
- Automatically saves unfinished workout input so you can continue after a reload
- Shows workout history and exercise progress trends
- Tracks body weight, chest, waist, and arm measurements
- Supports training-template changes proposed through ChatGPT and confirmed inside the Plan page
- Optionally syncs training data across devices through a Private GitHub repository
- Imports and exports local JSON backups
- Can be installed as a PWA with offline access to cached app resources

## Basic workflow

1. Open **Plan** and choose a training template.
2. Review the next-workout suggestion generated from your training history.
3. Adjust weight, reps, or sets if needed.
4. Tap **Push Plan** to make it the active workout.
5. Open **Training**, complete the session, and enter what you actually performed.
6. Save the workout. It will be added to **History** and used when generating future suggestions.

You can prepare suggestions for other templates at the same time, but there is only one active workout for the whole app. Pushing another plan directly replaces the previous active workout.

## Plans and templates

### Regenerating a workout suggestion

Use **Regenerate** on the Plan page to rebuild the suggestion from the current template and your latest training history.

If you manually edited the suggestion and its underlying history or template later changes, the app will ask whether you want to:

- keep your current adjustments, or
- regenerate from the latest data.

### Editing a training template

A training template represents your long-term training rules. Changing a template only affects future suggestions. It does not modify a workout that has already been pushed as the active plan.

When a template change is proposed through ChatGPT, it appears on the Plan page for review. After you tap **Confirm Change**, the template is updated immediately and a new workout suggestion is generated from the updated template.

## Recording a workout

The Training page can record:

- weight
- reps
- RIR
- completion status for each set
- temporary set-count changes for the current session

Unfinished input is automatically saved on the current device. You can reload or reopen the app and continue the workout.

After the workout is saved, the completed data becomes part of your training history and the active workout is cleared.

## History, trends, and body data

Use **History** to review completed sessions.

Use **Trends** to follow exercise performance over time.

You can also track:

- body weight
- chest circumference
- waist circumference
- arm circumference

These records can be stored and synced together with your training history.

## Private GitHub sync

If you only use one device, GitHub sync is completely optional.

For multiple devices, create a separate **Private GitHub repository** for your training data.

### Setup

1. Create a Private GitHub repository.
2. Create a fine-grained personal access token with only the repository Contents permissions required for reading and writing the training data.
3. Open **Settings → GitHub Sync** in the app.
4. Enter your GitHub username, private repository name, and token.
5. Save the sync settings.

Configure the same private repository once on each device you want to use.

### Using a new device

On a new device:

1. Configure the same Private GitHub repository.
2. Merge the latest data from GitHub.
3. Check that your plans and history are present, then continue using the app normally.

The app attempts to avoid silently overwriting newer changes from another device. When a conflict requires your attention, it will surface the conflict instead of silently replacing the data.

## Local backups

Open **Settings → Local Backup** to:

- export a JSON backup
- import an existing JSON backup
- clear training data from the current device

Exporting a backup is useful before moving to another device or making a large change to your training templates.

GitHub sync credentials are not included in exported training backups.

## Install as an app

Lianleme is a PWA. In a browser with PWA support, use the browser menu or the app's install entry to add it to your desktop or home screen.

Once installed, it can be opened like a normal app. Cached interface resources can load offline, while GitHub synchronization still requires an internet connection.

## If an update looks stuck

If an update leaves the app showing clearly outdated cached files, open:

```text
rescue.html
```

It clears the app's Service Worker and static cache before reloading the latest version. It does not delete training data stored in the browser.
