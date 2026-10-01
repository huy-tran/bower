# Bower

A prompt-driven motion graphics editor. Each scene is an HTML file animated as a pure function of time. You change a scene by chatting with Claude Code, scrub and play it back in the browser, sync it to music and sound, and export video.

## Requirements

- Node 22+
- Claude Code CLI (`claude`) on the PATH and logged in
- `npm install` downloads headless Chrome (Puppeteer) and ffmpeg (ffmpeg-static)

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

On first run an example project ("Example: Product teaser") is created in `storage/projects/`.

## Features

**Working with Claude**
- **Storyboard** (the Storyboard button): write a brief, set a target length and whether you want narration, and Claude drafts the scene list with a title, duration, brief and voice-over line per scene. Edit, reorder, add or remove scenes, then create them, replacing or following the current ones. Each scene keeps its brief in its meta block, and Claude builds the scenes one after another while the header shows progress.
- A chat per scene, plus a Project chat that can change any scene. Every change is saved as a version, with Undo, restore, and a side-by-side **Compare versions** view.
- **Visual checks** (Settings, General): Claude renders snapshots of the frames it changed and looks at them before replying, and runs the seam checker when a cut should be invisible.
- **Reference images**: attach with the paperclip, drag onto the chat, or paste. Claude looks at them before editing.
- **Playhead chip**: the pin button inserts "(at 1.20s)" so you can point at a moment. Claude is also told where your playhead is.
- **Model picker**: Default, Opus, Sonnet or Haiku, per message.
- Replies stream in as Claude writes, with a live list of what it is reading, editing and looking at.
- **Voice input**: see below.
- **Fix with Claude**: when a scene throws an error, the error banner offers a one-click fix.
- **The running product** (Settings, App): give the app's address, sign in once in a browser window Bower opens (the session is kept in a per-project Chrome profile on this machine), then capture screenshots of real screens at desktop, laptop, tablet or mobile size, whole page or not. Screenshots land in `assets/shots/`, can be attached to the chat with one click, and Claude can take its own with `node bower.mjs shot <page>` to use as references or to place inside device frames in scenes.
- **Linked codebases** (Settings, Codebase): link one or more local repos, for example the API and the frontend, each with a label and a note on where to look. Leave the note empty and Claude reads the repo and writes it (Rescan redoes it). Paste a path or use **Browse…**, which opens your computer's folder chooser. Claude can then read them (never edit them) to rebuild the product's real screens, components, data, colours and copy in scenes. Paths are per machine, so they are left out of exports.

**Timeline and playback**
- Whole-video or single-scene playback, speed control (0.25×, 0.5×, 1×), a loop region, and timeline zoom.
- **Transitions** between scenes: crossfade, push, slide, wipe, zoom or blur dissolve. Pick one in the gap between two thumbnails.
- **Seam checker**: each gap shows what percentage of pixels jump at the cut. Open it to see the comparison image or ask Claude to make the cut seamless.

**Music, sound and captions** (the Sound button)
- Music is built but hidden for now (`FEATURES.music` in `app/utils/features.ts`): the Add music button, drop-to-sync and the music section of the Sound panel are off until it is needed.
- Drop a music track anywhere. Bower detects tempo, beats, downbeats, phrases and **sections** (intro, build, drop, breakdown, outro), shows them on the timeline and gives them to Claude.
- Music volume, fade in and out, and automatic **ducking** under voice-over.
- **Sound effects and voice-over** clips placed at the playhead, each with its own volume.
- **Generated voice-over**: speech is made in the browser with Kokoro, a free open-source model (about 90 MB, downloaded once, runs offline, English only), and caption lines come with it, timed per sentence. Two ways in:
  - **Ask Claude**, for example "write a voice-over for the whole video". Claude puts each scene's script in the `voice` key of the scene's meta block and the editor narrates every scene automatically, pinned to the scene's start. Change the script and it is regenerated; remove it and the clip goes.
  - **One-off line**: type it in the Sound panel, preview, and add it at the playhead.
  - The narrator voice and speed live in Settings, Sound, with a **pronunciation** list for product names and acronyms the voice gets wrong. Captions keep the real spelling. A scene can name its own voice in the meta block.
- **Captions**: transcribe voice-over in the browser with Whisper (about 80 MB, downloaded once, runs offline) and edit the lines. Position, size, burn-in and `.srt` / `.vtt` downloads are in Settings, Sound.

**Scene templates**
- Save any scene as a template from the scene toolbar (the bookmark button), with a name, a description and a thumbnail. Insert one into any project from Add scene, then From a template. By default Claude then adapts the copy to the project's brand kit, art direction and stage size. Templates live in `storage/templates/`.

**Projects and brands**
- **Folders**: group projects in folders and subfolders from the project picker in the header. Search by name, create, rename or delete folders, and move a project with its menu or from Settings, General. Folders are virtual: nothing moves on disk, so export, import and the trash are unaffected.
- Rename, duplicate, delete (to a **trash** kept for 30 days), export and import as `.zip`.
- **New version for social**: copies the project at 9:16, 1:1, 4:5 or 16:9, and Claude re-lays out every scene for the new shape.
- **Brand kits** (Settings, Brand kit): colours, Google Fonts, logos and notes, shared across projects. Claude follows the kit a project uses.
- **Project settings** (the Settings button, or the project menu): name, stage, visual checks, art direction, brand kit, codebase, narrator and captions in one place with tabs. Changes save as you make them.
- Light and dark mode.

**History**
- The project menu's **History** lists every change to every scene across the project, newest first, including deletions. **Rewind here** puts every scene back to its latest version at that moment, trashing scenes created later and restoring scenes deleted later. Later versions stay available, so a rewind can be undone the same way.

**Export** (Render tab)
- **Presets** (MP4 full quality, fast preview, GIF, ProRes) plus your own saved settings, shared across projects.
- **Queue**: renders run one at a time across all projects; extra ones queue up and can be removed before they start. The panel shows what is rendering, what is queued and the last few results.
- MP4 with the full sound mix, animated GIF, or ProRes 4444 with a transparent background for Premiere, Final Cut or After Effects.
- Frames render in parallel across several headless Chrome instances.
- **Web player**: one `.html` file with every scene, transition, caption and sound built in.

## Sharing

Bower runs on each person's own machine and uses their own Claude Code login. Nobody shares an account.

**Teammates (to edit):**

1. Clone this repo, then run `npm install` and `npm run dev`.
2. Install Claude Code and run `claude` once to sign in. If it's missing or signed out, the app shows a banner.
3. To hand over a project, use the `...` menu next to the project picker, then **Export project (.zip)**. The other person uses **Import project...** on their copy. The zip contains the scenes, music, sound clips and captions, assets, brand files, transitions and art direction. Renders, versions and chat history stay on the machine where they were made.

**Everyone else (to watch):**

- **Render tab, then Render:** makes an MP4, GIF or ProRes file.
- **Render tab, then Web player, then Download:** makes one `.html` file that plays in any browser with no server, so you can email it, post it in Slack, or host it anywhere as a static file (Netlify Drop, S3, a website). It loads fonts from Google Fonts, so viewers need an internet connection for the typography to be exact.

## How it works

- `storage/projects/<id>/` holds `project.json`, `scenes/<id>.html`, a generated `CLAUDE.md` (the scene contract, brand kit and art direction), `bower.mjs` (the helper Claude uses to look at frames), `audio/`, `assets/`, `brand/`, `snapshots/`, `renders/` and `.bower/` (versions, chats and trash).
- Each chat message runs `claude -p` in the project folder. Claude may read and edit files, and may run exactly one command: `node bower.mjs` (snapshots and seam checks, rendered by the Bower server). The session is resumed per scene. Each linked codebase is passed with `--add-dir`, which grants read access outside the project folder.
- Scenes call `VE.scene({ render(t) { ... } })`. The editor, thumbnails, web player and renderer all drive them through `VE.seek(t)`, so every frame is deterministic.
- Transitions, captions and the music level curve are shared code (`shared/utils/timeline.ts`), so the editor, web player and renders match exactly.
- Rendering films the render mode of the web player: each worker gets its own headless Chrome, writes a segment, and ffmpeg joins the segments and mixes the sound.

## Environment

| Variable | Purpose |
| --- | --- |
| `BOWER_STORAGE` | Projects folder (default `storage/projects`; trash and brand kits live next to it) |
| `BOWER_MODEL` | Default model passed to `claude --model` (the chat's model picker overrides it) |
| `CLAUDE_BIN` | Path to the `claude` executable |

## Shortcuts

| Key | Action |
| --- | --- |
| Space, or click the preview | Play / pause |
| ← / → | Step one frame (Shift: 1 second) |
| ↑ / ↓ | Previous / next scene |
| I / O | Set loop in / out at the playhead (or Shift-drag on the timeline) |
| L | Clear the loop |
| + / − / 0 | Zoom the timeline in / out / reset (or Ctrl/⌘ + scroll) |
| Home | Back to the start (of the loop) |
| Enter | Send prompt (Shift+Enter: new line) |

## Voice input

Click the microphone in the chat box to dictate a prompt instead of typing it. Your words appear in the box as you speak, after anything you've already typed. Click the mic again to stop, then edit if needed and press Enter. Pressing Enter while still listening sends everything you've said so far.

It uses the browser's built-in speech recognition, so it works in Chrome, Edge and Safari but not Firefox (the mic button is hidden there). The browser asks for microphone permission the first time. In Chrome, your speech is sent to Google's speech service to be turned into text.
