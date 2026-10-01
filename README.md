# Storyboard

A prompt-driven motion graphics editor. Each scene is an HTML file animated as a pure function of time. You change a scene by chatting with Claude Code, scrub and play it back in the browser, sync it to music, and export an MP4.

## Requirements

- Node 22+
- Claude Code CLI (`claude`) on the PATH and logged in
- `npm install` downloads headless Chrome (Puppeteer) and ffmpeg (ffmpeg-static)

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

On first run an example project ("Example: Flux teaser") is created in `storage/projects/`.

## Sharing

Storyboard runs on each person's own machine and uses their own Claude Code login. Nobody shares an account.

**Teammates (to edit):**

1. Clone this repo, then run `npm install` and `npm run dev`.
2. Install Claude Code and run `claude` once to sign in. If it's missing or signed out, the app shows a banner.
3. To hand over a project, use the `...` menu next to the project picker, then **Export project (.zip)**. The other person uses **Import project...** on their copy. The zip contains the scenes, music, assets and art direction. Renders, versions and chat history stay on the machine where they were made.

**Everyone else (to watch):**

- **Render tab, then Render:** makes an MP4.
- **Render tab, then Web player, then Download:** makes one `.html` file with every scene and the music built in. It plays in any browser with no server, so you can email it, post it in Slack, or host it anywhere as a static file (Netlify Drop, S3, a website). It loads the Inter font from Google Fonts, so viewers need an internet connection for the typography to be exact.

## How it works

- `storage/projects/<id>/` holds `project.json`, `scenes/<id>.html`, a generated `CLAUDE.md` (the scene contract plus art direction), `audio/`, `renders/` and `.storyboard/` (versions and chats).
- Each chat message runs `claude -p` in the project folder with edit-only tools. The session is resumed per scene, so each scene keeps its own conversation. Every change to a scene file is saved as a version.
- Scenes call `VE.scene({ render(t) { ... } })`. The editor, the thumbnails and the renderer all drive them through `VE.seek(t)`, so every frame is deterministic.
- Dropped audio is analysed in the browser (spectral-flux onsets, then tempo, beat grid, downbeats and 8-bar phrases). Beat times are exposed to scenes as `VE.beats` / `VE.downbeats` / `VE.phrases` and included in every prompt.
- Rendering steps each frame in headless Chrome, pipes JPEGs to ffmpeg, and muxes the music from the project's start offset.

## Environment

| Variable | Purpose |
| --- | --- |
| `STORYBOARD_STORAGE` | Projects folder (default `storage/projects`) |
| `STORYBOARD_MODEL` | Model passed to `claude --model` (default: your Claude Code default) |
| `CLAUDE_BIN` | Path to the `claude` executable |

## Shortcuts

Space: play/pause · ←/→: step one frame (Shift: 1s) · ↑/↓: previous/next scene · Ctrl/⌘+Enter: send prompt
