import { execFile } from 'node:child_process'

// Puppeteer starts browsers with windowsHide on Windows, and Windows applies that start-up setting
// to a program's first ShowWindow call, so a visible (headless: false) Chrome comes up with its
// window hidden: the user sees a blank frame or nothing at all. This shows the browser's window.
// Elsewhere it does nothing.
//
// The script is a fixed string; the process id reaches it only through an environment variable.
const SCRIPT = `
  Add-Type @"
  using System; using System.Runtime.InteropServices; using System.Text;
  public class BowerShow {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    // 0: no browser window yet, 1: it was hidden and has been shown, 2: it was already visible.
    public static int Run(uint want) {
      int state = 0;
      EnumWindows((h, l) => {
        uint p; GetWindowThreadProcessId(h, out p);
        var c = new StringBuilder(64); GetClassName(h, c, 64);
        if (p == want && c.ToString() == "Chrome_WidgetWin_1" && GetWindowTextLength(h) > 0) {
          if (IsWindowVisible(h)) { state = Math.Max(state, 2); }
          // Twice: this PowerShell is itself started hidden, and Windows applies a process's start-up
          // show setting (hide) to its first ShowWindow call instead of the one asked for.
          else { ShowWindow(h, 1); ShowWindow(h, 1); SetForegroundWindow(h); state = Math.Max(state, 1); }
        }
        return true;
      }, IntPtr.Zero);
      return state;
    }
  }
"@
  [BowerShow]::Run([uint32]$env:BOWER_SHOW_PID)
`
const ARGS = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')]

function showOnce(pid: number) {
  return new Promise<number>((resolve) => {
    execFile('powershell.exe', ARGS, { timeout: 20_000, windowsHide: true, env: { ...process.env, BOWER_SHOW_PID: String(pid) } }, (err, stdout) => {
      if (err) console.warn(`[bower] could not show the browser window: ${err.message.split('\n')[0]}`)
      resolve(err ? 0 : Number.parseInt(String(stdout).trim(), 10) || 0)
    })
  })
}

// Keeps at it until a check finds the window already visible: shown too early, while Chrome is still
// setting the window up, it gets hidden again. Gives up after about ten seconds.
export async function showBrowserWindow(pid: number | undefined) {
  if (process.platform !== 'win32' || !pid) return
  for (let i = 0; i < 20; i++) {
    if (await showOnce(pid) === 2) return
    await new Promise(r => setTimeout(r, 500))
  }
  console.warn(`[bower] could not show the window of browser process ${pid}`)
}
