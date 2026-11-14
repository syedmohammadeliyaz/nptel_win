# NPTEL Library for Windows

The same app as the Android one, as a normal Windows program: every NPTEL course, organised by subject
(A to Z inside each), lectures that load as you scroll, bookmarks for single lectures, and an in-app player that
moves on to the next lecture by itself. Lecture lists come live from YouTube, so nothing is missing and nothing
big is stored on your PC.

On a wide window the course page shows the player on the left and the lecture list on the right.

## Get the app (GitHub builds it for you, nothing to install)

1. Put this folder in your `nptel` repository, next to `app/`, so the repo contains `windows/` and
   `.github/workflows/build-windows.yml`, and push it to `main`.
2. Open the repository on GitHub, then **Actions**, then **Build Windows app**. It takes about 5 to 8 minutes.
   (You can also start it with the **Run workflow** button.)
3. Open the finished run and download **NPTEL-Library-Windows** at the bottom. Unzip it. You get two files:
   - `NPTEL-Library-Setup-2.1.1.exe`: installer, per user, no administrator rights needed. Start menu and desktop shortcut.
   - `NPTEL-Library-Portable-2.1.1.exe`: no install, runs from any folder. Starts a few seconds slower.
4. Run one of them.

**Windows says "Windows protected your PC"?** The app is not code-signed (a signing certificate costs money), so
SmartScreen warns about any new unsigned program. Click **More info**, then **Run anyway**. If Smart App Control
blocks it with no "Run anyway" button, either turn Smart App Control off (Windows Security, App & browser control)
or run it from source (below).

The run page also shows a **Live check** report: the build opens the finished app on GitHub's machine, loads a real
lecture list from YouTube and starts a video. If a video ever refuses to play for you, that report is the first
thing to look at.

## Using it

| Do this | How |
| --- | --- |
| Search all courses | Click the search box, or press `/` or `Ctrl+K`. `Esc` clears it. |
| Open a subject, then a course | Click. Lectures keep loading as you scroll the list. |
| Play a lecture | Click it. The next one starts automatically when it ends. |
| Bookmark a lecture | Click the bookmark on its row, or press `B` while it plays. See them under **Saved**. |
| Go back | Back arrow, `Alt+Left`, `Backspace`, or the mouse's Back button. |
| Next lecture | `N` (after clicking in the list; once you click inside the video, YouTube's own keys apply). |
| Full screen | `F11`, or the player's full-screen button. |
| Zoom | `Ctrl` + `+` / `-` / `0`. Window size, position and zoom are remembered. |
| Reload the page | `F5`. |
| Lecture won't play inside the app | Use the **Open in YouTube** button, which opens that lecture in your browser. |

Your bookmarks live in `%APPDATA%\NPTEL Library` (installer version) or in a `NPTEL-Library-data` folder next to
the `.exe` (portable version). Uninstalling keeps them. The two versions keep separate bookmarks.

## What it does on your PC

- It talks only to YouTube (lecture lists, thumbnails, the player). No accounts, no tracking, no updates server.
- The page is served from inside the app at `http://nptel-library.localhost`. No port is opened on your PC.
- The window has no access to Windows or your files. The only things the page can ask the app to do are "list this
  playlist" and "open this YouTube link in my browser", and both are checked again by the app.
- Links, pop-ups and navigation away from the app are blocked; YouTube links open in your default browser.
- The Electron safety switches that make an app harder to tamper with are turned on in the built `.exe`.

## Size

The installer is about 100 MB and the app uses about 300 MB once installed, because it carries its own copy of the
Chromium browser engine. The lectures themselves are streamed, not stored.

## Run it from source (also the way around SmartScreen)

Needs Node.js 22 or newer.

```
cd windows
npm install
npm start          # the app
npm test           # 31 unit tests
npm run selftest   # same live check as in the build: needs internet, opens a window, exits by itself
```

`npm run dist` builds the installer and portable exe on a Windows machine, the same way the GitHub workflow does.
`npm start -- --devtools` allows `F12` developer tools.

## Notes for developers

- `main.js` and `lib/app.js` start the app. `lib/guards.js` (what may be opened or navigated),
  `lib/ipc.js` (what the page may ask for), `lib/youtube.js` (the YouTube request) and `lib/urls.js` hold the rules,
  and each has unit tests in `test/unit`.
- `preload.js` gives the page the same small `Native` interface the Android app has, so one page serves both.
- `src/index.html` is the page. It is generated from the same source as the Android page (same course list, same
  behaviour) plus desktop-only layout and keyboard shortcuts. If NPTEL adds courses, a new page file is all that changes.
- `test/e2e/main-e2e.js` starts the real app against a stand-in YouTube server and clicks through it
  (`scripts/e2e.sh`, Linux with xvfb).
- Dependency versions are fixed by `package-lock.json`; the workflow installs with `npm ci`.
