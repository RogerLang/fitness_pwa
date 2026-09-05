# Lianleme

> A lightweight PWA for personal strength training: plan your next workout, record what you actually did, and review your progress over time.

[中文 README](./README.md)

## What it does

- Generates, adjusts, and pushes your next workout from your training template and history
- Records weight, reps, RIR, and set completion while automatically saving unfinished input
- Lets you temporarily change set counts without altering the long-term template
- Shows workout history, exercise trends, and body measurements
- Supports training-template changes proposed through ChatGPT and confirmed in the app
- Optionally syncs data across devices through a Private GitHub repository
- Supports JSON backups and installation as a PWA on desktop or mobile

## How to use it

The normal workflow is straightforward:

1. Open **Plan** and choose a training template.
2. Review the next-workout suggestion generated from your training history.
3. Adjust weight, reps, or sets for the upcoming session if needed.
4. Tap **Push Plan** to make it the active workout.
5. Open **Training** and enter what you actually perform as you train.
6. Save the workout. It becomes part of **History** and is used when generating future suggestions.

There is only one active workout for the whole app. Pushing another plan directly replaces the previous active workout.

## Planning a workout

Choose a training template on the **Plan** page and the app will generate your next-workout suggestion from that template and your previous sessions. You can adjust weight, reps, and sets before pushing it as the active workout.

The training template contains your long-term rules, such as exercises, target rep ranges, planned set counts, and starting weights. Editing the template only affects future suggestions and does not modify an active workout that has already been pushed.

### Regenerate

Tap **Regenerate** to rebuild the next-workout suggestion from the current template and your latest training history.

If you already edited the suggestion and its underlying template or history later changes, the app lets you either keep your current adjustments or regenerate from the latest data.

### ChatGPT template changes

When a template change is proposed through ChatGPT, it appears on the Plan page for review.

After you tap **Confirm Change**, the template is updated immediately and a new workout suggestion is generated from the updated template. An already-pushed active workout remains unchanged.

## Recording a workout

The Training page can record:

- weight
- reps
- RIR
- completion status for each set
- temporary set-count changes for the current workout

Unfinished input is automatically saved on the current device. You can reload or reopen the app and continue where you left off.

After you save the workout, the completed data becomes part of your history and the active workout is cleared automatically.

## History, trends, and body data

Use **History** to review completed workouts.

Use **Trends** to follow exercise performance over time.

You can also track:

- body weight
- chest circumference
- waist circumference
- arm circumference

## Multi-device sync

If you only use one device, GitHub sync is completely optional.

For phone-and-computer use, create a separate **Private GitHub repository** for your training data.

Initial setup:

1. Create a Private GitHub repository.
2. Create a fine-grained personal access token with only the repository Contents permissions needed for reading and writing the training data.
3. Open **Settings → GitHub Sync**.
4. Enter your GitHub username, private repository name, and token.
5. Save the sync settings.

On a new device, configure the same private repository and merge the latest data from GitHub to continue using the app.

If changes from different devices require manual attention, the app surfaces a conflict instead of silently overwriting the newer data.

## Local backups

Open **Settings → Local Backup** to:

- export a JSON backup
- import an existing JSON backup
- clear training data from the current device

Exporting a backup is useful before moving to another device, making a large template change, or simply keeping an extra copy of your data.

GitHub sync credentials are not included in exported training backups.

## Install as an app

Lianleme is a PWA.

In a browser with PWA support, use the browser menu or the app's install entry to add it to your desktop or home screen.

Once installed, it can be opened like a normal app. Cached interface resources can load offline, while GitHub synchronization still requires an internet connection.

## If an update looks stuck

If an update leaves the app showing clearly outdated files, open:

```text
rescue.html
```

This clears the app's Service Worker and static cache before loading the latest version. It does not delete training data stored in the browser.
