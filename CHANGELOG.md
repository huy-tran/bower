# Changelog

What changed in each version of Bower, newest first. Each release's notes on GitHub, and in the update dialog inside
the app, come from its section here: add a `## x.y.z` section before tagging `vx.y.z` (the release stops without one).

## 0.12.0 (16 October 2026)

### New
- **Animate by hand, After Effects style**: the Edit by hand tab now has a Layer tab.
  - **Layers**: pick any element of a scene from the list or by clicking it in the preview.
  - **Transform box**: drag the picked element to move it, drag a corner to scale it, or use the round handle to
    rotate it.
  - **Inspector**: set position, scale, rotation, opacity, blur, colour, background, font size, letter spacing and
    corner radius. Drag a label left or right to change its value.
  - **Keyframes**: click the stopwatch on a property to animate it. Changing the value at another moment adds a
    keyframe there.
  - **Keyframe timeline**: keyframes show as diamonds under the inspector. Drag them to retime, or click one to pick
    its easing, including a custom curve you shape yourself.
  - **Motion path**: when an element moves, its path is drawn in the preview.
- **Animation presets**: one click adds Fade in, Slide up, From the left or right, Pop, Zoom in, Blur in or
  Typewriter, or an exit (Fade out, Slide down, Shrink, Blur out), starting at the playhead.
- **Claude animates with keyframes too**: scenes Claude builds or edits from now on use keyframes for simple motion,
  so you can retime and adjust them by hand.

### Improved
- **Hand edits wait for Save**: changes made by hand show in the preview straight away but are only kept when you
  click Save (Ctrl+S), as one version. Discard throws them away and Undo takes them back one at a time.
  - Unsaved changes stay when you switch scenes or close Bower, and the scene's thumbnail says Unsaved.
  - Renders and Claude use the saved scene, so the chat asks you to save or discard first.
- **The code editor is easier to use**:
  - A bar jumps to each part of the file, and Show in code opens it at the element you picked.
  - Typing `VE.` lists the scene helpers.
  - Format tidies the code.
  - Long lines wrap.
  - An error in the preview is marked on its line, with a button to go there.
  - Apply puts your code into the scene's unsaved changes.

## 0.11.0 (16 October 2026)

### New
- **Edit by hand**: a new tab next to Chat with Claude for small changes that need no Claude run. Every change is
  saved as a version marked "By hand", so Undo and History cover it, and Claude is told about it before your next
  message so it keeps your changes.
  - **Retype text in the preview**: click to pick an element, double-click text to retype it in place. Enter saves,
    Esc cancels.
  - **Settings**: scenes can offer the values worth tweaking (colours, sizes, copy) as fields, colour pickers,
    sliders and menus, and the preview updates as you change them. New scenes get them; for older ones, click
    Ask Claude to add settings.
  - **Timing**: each animation is a bar on a small timeline. Drag it to move it, drag an edge to make it shorter or
    longer, and drag the end marker to change the scene's length.
  - **Code**: open the scene's code in an editor with a live preview, and save with Ctrl+S.
  - **Ask Claude about this**: pick something in the preview and hand it to the chat, so "make this bigger" needs
    no further description.
- **Brand colours and fonts follow the kit**: scenes Claude writes now use the brand kit's colours and fonts through
  variables, so changing the kit restyles them. Older scenes keep their own colours until Claude updates them.

## 0.10.0 (6 October 2026)

### New
- **Auto model for chat**: pick Auto in the chat box, or for Chat edits in Project settings, Claude models. Haiku
  sizes up each request first and sends it to the lightest model that can do it: Haiku for small tweaks (copy,
  colours, timing), Sonnet for most edits, Opus for building or redesigning scenes. Small tweaks also skip the
  screenshot check. Sizing adds a few seconds before Claude starts and costs a fraction of a cent.

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
