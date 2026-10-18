'use strict';
// Watches the foreground window (title, process name) through ONE PowerShell process that keeps running.
// No native module needed -> easy to ship.
// It also reports every mouse button pressed by hand, wherever on the screen ({ click: [x, y] },
// physical pixels): the overlay never takes the focus from the game, so a click into the game is
// seen here and not as the overlay losing the focus.
const { spawn } = require('child_process');

function script(names) {
  const list = names.map((n) => "'" + String(n).replace(/'/g, "''") + "'").join(',');
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }

  // one line at a time – the mouse thread writes too
  static readonly object outLock = new object();
  public static void Say(string line) { lock (outLock) { Console.WriteLine(line); Console.Out.Flush(); } }

  // a low level mouse hook on a thread of its own (it needs a message loop)
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)]
  struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
  static HookProc hookFn;                       // kept, so the collector does not take it
  static IntPtr hook = IntPtr.Zero;
  static IntPtr OnMouse(int code, IntPtr w, IntPtr l) {
    int m = (int)w;
    if (code >= 0 && (m == 0x0201 || m == 0x0204 || m == 0x0207)) {          // left, right, middle down
      MSLLHOOKSTRUCT s = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
      if ((s.flags & 1) == 0) Say("{\\"click\\":[" + s.x + "," + s.y + "]}");    // flag 1 = sent by a program (click spam)
    }
    return CallNextHookEx(hook, code, w, l);
  }
  public static void WatchMouse() {
    Thread t = new Thread(() => {
      hookFn = OnMouse;
      hook = SetWindowsHookEx(14, hookFn, GetModuleHandle(null), 0);         // WH_MOUSE_LL
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    });
    t.IsBackground = true;
    t.Start();
  }
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$names = @(${list})
[FG]::WatchMouse()
while ($true) {
  $h = [FG]::GetForegroundWindow()
  $wpid = [FG]::Pid($h)
  $proc = ''
  $p = Get-Process -Id $wpid
  if ($p) { $proc = $p.ProcessName }
  $running = (@(Get-Process -Name $names)).Count -gt 0
  [FG]::Say((@{ title = [FG]::Title($h); proc = $proc; pid = [int]$wpid; running = [bool]$running } | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 400
}
`;
}

// PowerShell always writes "#< CLIXML" to stderr and wraps real errors as XML after it.
// Neither is usable as is -> drop the header, unpack the message.
function unwrapPsError(data) {
  const t = String(data).replace(/#<\s*CLIXML\s*/i, '').trim();
  if (!t.startsWith('<Objs')) return t;
  if (!/<S S="Error">/.test(t)) return '';                 // only the progress noise
  const parts = [...t.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]);
  return parts.join('')
    .replace(/_x000D_|_x000A_/g, ' ')
    .replace(/&lt;|&gt;|&amp;|&quot;/g, (e) => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' }[e]))
    .replace(/\s+/g, ' ')
    .replace(/\s*\+ CategoryInfo[\s\S]*$/, '')             // PowerShell's trimmings
    .replace(/^.*?\s:\s/, '')                              // the command text in front
    .trim();
}

/** onState(window state) every 400 ms, onClick([x, y]) on every mouse button pressed by hand. */
function startWatcher(processNames, onState, onError, onClick) {
  if (process.platform !== 'win32') { onError && onError(new Error('window detection works on Windows only')); return () => {}; }
  const enc = Buffer.from(script(processNames), 'utf16le').toString('base64');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      let s;
      try { s = JSON.parse(line); } catch (_) { continue; }         // an incomplete line
      if (s.click) { if (onClick) onClick(s.click); } else onState(s);
    }
  });
  ps.stderr.on('data', (d) => {
    const t = onError && unwrapPsError(d);
    if (t) onError(new Error(t));
  });
  ps.on('error', (e) => onError && onError(e));
  return () => { try { ps.kill(); } catch (_) {} };
}

module.exports = { startWatcher, unwrapPsError, script };
