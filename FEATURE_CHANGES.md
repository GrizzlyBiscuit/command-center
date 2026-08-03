# Controller and media preview

This preview is isolated on `agent/video-library-now-playing`; trying it does not change `main`. It contains controller navigation, the local music player, video and Now Playing views, improved media UX, portable launcher updates, and the Particle accelerator visualizer. Selected media stays local and is not added to Git.

## Try everything safely

From PowerShell, make a separate preview copy:

```powershell
git clone --branch agent/video-library-now-playing --single-branch https://github.com/GrizzlyBiscuit/command-center.git command-center-preview
cd command-center-preview
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Then double-click `launcher\launch_cc.vbs` and open `http://localhost:5050`.

- Choose folders under **Music > Settings** and **Video > Settings** (MP4/WebM).
- Connect a controller and press a button, or use the keyboard shortcuts shown by `?`.
- For phone testing, open `http://<PC-IP>:5050` on the same LAN. Keep the launcher open or minimized to use **Command Center PC** playback.
- Try the Home **Now Playing** card and **Visualizer > Particle accelerator**.

## Merge if approved

The draft pull requests are stacked. Use regular **Merge pull request** commits (not squash or rebase), in this order:

1. Merge [#1: Controller navigation](https://github.com/GrizzlyBiscuit/command-center/pull/1) into `main`.
2. Retarget and merge [#2: Music library and LAN/PC playback](https://github.com/GrizzlyBiscuit/command-center/pull/2) into `main`.
3. Retarget and merge [#3: Video, media UX, launcher, and visualizer](https://github.com/GrizzlyBiscuit/command-center/pull/3) into `main`.

Mark each draft ready before merging. After each merge, verify the next pull request's **Files changed** view only shows its own layer. To take everything in one merge instead, retarget #3 to `main`, merge it, and close #1 and #2 as superseded.
