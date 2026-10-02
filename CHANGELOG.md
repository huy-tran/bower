# Changelog

What changed in each version of Bower, newest first. Each release's notes on GitHub, and in the update dialog inside
the app, come from its section here: add a `## x.y.z` section before tagging `vx.y.z` (the release stops without one).

## 0.6.0 (2 October 2026)

### New
- **Command palette.** Press Ctrl+K anywhere to search and run actions, jump to a scene, open another project or a
  settings tab, or switch the theme.
- **What's new.** The update dialog lists what changed in the new version, and About shows the notes for the version
  you have.
- **Playback shortcuts you can change**, in Bower settings, Shortcuts: Play / Pause (Space), switch between This scene
  and Whole video (V), and Play from the start (Shift+Space). The settings also list every other shortcut.

### Improved
- The desktop app has no menu bar or Windows title bar any more: Bower's own top strip takes their place, with the
  window buttons drawn in Bower's colours (light or dark). Drag the strip or the toolbar to move the window.

## 0.5.0 (2 October 2026)

### New
- **Real flows as video clips.** Claude can record a flow through your app (opening a menu, filling a form) with a
  visible cursor and natural timing, and play it inside a scene. Clips render frame-exactly, so a video looks the same
  every time you export it. You can also record one yourself with Record video in Settings, Screenshots.
- **Live UI.** Claude can capture a page of your app as its real markup and styles instead of a picture, then animate
  parts of it: rows fading in, a button lighting up, text being typed into a field. It looks exactly like the product.
- **Shared apps.** An app's address, notes, linked code and sign-in are set up once and used by every project about
  it, so you sign in once instead of once per video. Existing projects are linked to a shared app automatically.
- **Bower settings**, in the Bower menu: where Claude Code is, the model chats use by default, what new projects start
  with (shape, frame rate, narrator), your apps, and the theme, including a "match system" option.
- **Setup checklist and setup chip.** A checklist in Settings, General, and a chip in the toolbar that shows how far
  setup has got: amber when barely started, blue when nearly there, red when something broke (the app stopped
  answering, or Bower was signed out).
- **Signing in made simple.** Test connection explains problems in plain words. Bower notices when it has been signed
  out instead of capturing the sign-in page, and an optional saved login (encrypted for your Windows account) lets it
  sign back in by itself.
- **Record steps** by clicking through your app instead of writing them by hand, and let Claude write the "Getting
  around" notes by walking your app's menus.
- **About Bower**, with the version, build date and the tools Bower uses on this computer.

### Improved
- The Bower menu on the logo holds new and recent projects, all projects, settings, theme and About. The open
  project's name is now a menu of its actions.
- Render is the main toolbar button. Present, Storyboard and Settings sit beside it, and the shape of the video now
  lives in the project menu.
- Bower finds Claude Code wherever it is installed, including npm installs, and you can point it at Claude Code by hand.

## 0.4.0 (2 October 2026)

### New
- Choose how Claude shows your app: real screenshots, screens rebuilt in HTML, or let Claude decide. Set it for the
  whole project and override it for a single scene from the picker in its chat.

### Improved
- Screenshots have their own tab in Settings.
- Linking a repository happens behind an Add repository button, so the Codebase tab stays tidy.
- More breathing room in the settings sidebar.

## 0.3.0 (1 October 2026)

### New
- The storyboard's target length is optional: leave it to Claude and it sizes the video to the brief.
- Build storyboard scenes one at a time, with Next scene, Build the rest, Redo and Stop after each one, or stop a build
  partway through.

## 0.2.0 (1 October 2026)

### New
- Screenshots can run steps first: click, type, choose, wait, scroll, hover and more, so Claude can capture real
  modals, menus and filled-in forms, several states in one go.

## 0.1.3 (1 October 2026)

### Improved
- When an update has downloaded, a dialog offers to restart now or later.

## 0.1.2 (1 October 2026)

### Fixed
- The sign-in window for your app now opens properly on Windows.

## 0.1.1 (1 October 2026)

### Improved
- A "Restart to update" button appears in the header once an update has downloaded.

## 0.1.0 (1 October 2026)

### New
- The first desktop release of Bower: write a brief, let Claude storyboard and build the scenes, adjust them by
  chatting, add music, narration and captions, and render the video. Includes folders, brand kits, scene templates,
  version history and the trash.
