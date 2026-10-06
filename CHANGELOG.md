# Changelog

What changed in each version of Bower, newest first. Each release's notes on GitHub, and in the update dialog inside
the app, come from its section here: add a `## x.y.z` section before tagging `vx.y.z` (the release stops without one).

## 0.9.0 (6 October 2026)

### New
- **Usage per project**: in Settings, Usage, see the tokens and cost of the Claude work on the project (chats,
  storyboards, codebase scans and app notes), by kind of work and by model. On a Claude subscription the cost is what
  the same work would cost at API prices. Reset starts counting again, for example after invoicing.
- **Claude plan meter**: the header shows how much of your 5-hour and weekly Claude limits is used and when they
  reset. Click it for both limits.
- **Limit alerts**: a warning at 80% and 95% of a limit, and a message when a limit is reached.

## 0.8.0 (6 October 2026)

### New
- **Publish to Cloudflare Pages**: in the Render tab, Web player, click Publish to put the video on its own
  `<name>.pages.dev` site and copy the link for your client. Publishing again updates the same link. Connect your
  Cloudflare account once in Bower settings, Publishing.

### Fixed
- The Export and Web player panels in the Render tab no longer get cut off at the bottom in a short window. The
  column scrolls instead.

## 0.7.0 (6 October 2026)

### New
- **Models per project**: in Settings, General, pick the Claude model for planning storyboards, building scenes and
  chat edits. Anything left on "Bower default" uses the model in Bower settings.
- The Storyboard dialog has a model picker for planning and one for building, starting on the project's settings.
- **Fresh start** in the chat: your next message starts a new Claude session, so earlier messages are not sent again.
  The messages stay on screen.

### Improved
- Bower uses fewer tokens:
  - The default model in Bower settings now applies to storyboards too, not just chats.
  - Codebase scans use Sonnet and app notes use Haiku.
  - Long chats start a new Claude session every 8 messages, with a short recap of the latest requests.
  - Claude only checks frames after changes to layout or motion, not after small copy, colour or timing tweaks.

## 0.6.4 (4 October 2026)

### Fixed
- In a window that is not full screen, the controls under the chat box (the model, how Claude shows the app, the
  microphone) no longer overlap. They wrap onto a second line instead.

## 0.6.3 (4 October 2026)

### Improved
- **A new look for Bower.** A bowerbird logo in the header and About, a matching desktop app icon, and a new
  browser tab icon.

## 0.6.2 (3 October 2026)

### New
- **Check for updates.** In the desktop app, About, the Bower menu and the command palette can look for a new
  version straight away instead of waiting for the hourly check. A new version downloads and then offers to restart
  into it as usual.

## 0.6.1 (3 October 2026)

### Fixed
- Renders longer than about 20 seconds no longer fail with "A scene did not draw its frame within 20 seconds" when
  every frame was actually drawn.

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
