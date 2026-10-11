'use strict';
// The macros: rapid clicking while a button is held, and lock (keys held down or pressed on a
// timer) – only while Diablo IV is the active window, and all off until the user switches them on.
//
// Node cannot read a held mouse button or send input on Windows, and a native module would
// break the portable build. So one small PowerShell helper does it (same approach as
// lib/winwatch.js): it polls the triggers, checks the foreground window and sends the input.
// It also watches the overlay's process id, so it can never stay behind as a stray clicker.
//
//   click spam    hold a button -> left / right clicks over and over
//   lock          a toggle key switches it on; every listed key (or mouse button) is either
//                 held down ("lock") or pressed again after its own number of seconds.
//                 Timed keys go first, in the user's order, pressed on top of the held ones.
//                 A left click by hand, left click spam or Space by hand (evade / teleport) pauses
//                 it the moment it goes down, until it is let go.
//                 (settings: lockOn, lockKeys [{ key, lock, sec }], lockBind)
//
// Whatever it holds it lets go again: when switched off, when the game is no longer in front,
// when it pauses, when it is told to stop (stdin closes) and when the overlay is gone.
const { spawn } = require('child_process');

// Triggers that can be bound, with their Windows virtual key codes.
// Mouse4/Mouse5 are the two thumb buttons (XBUTTON1/XBUTTON2).
const VK = {
  Mouse3: 0x04, Mouse4: 0x05, Mouse5: 0x06,
  Space: 0x20, CapsLock: 0x14, Tab: 0x09, Shift: 0x10,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28, Insert: 0x2D, Delete: 0x2E,
  '`': 0xC0, '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD, '\\': 0xDC,
  ';': 0xBA, "'": 0xDE, ',': 0xBC, '.': 0xBE, '/': 0xBF,
};

/**
 * What a macro can press or hold: digits, letters, Space, Shift and the five mouse buttons.
 * Mouse1 left · 2 right · 3 wheel · 4 / 5 the thumb buttons.
 */
const KEY_CHOICES = [...'1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'Space', 'Shift',
  'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'Mouse5'];
// mouse button -> the key code that tells whether it is down (left, right, wheel, thumb back, thumb forward)
const MOUSE_VK = { 1: 0x01, 2: 0x02, 3: 0x04, 4: 0x05, 5: 0x06 };

/** A choice as [key code, mouse button] – the button 0 for a key; null when it is no choice. */
function keyOf(name) {
  const k = String(name || '');
  if (!KEY_CHOICES.includes(k)) return null;
  const m = k.match(/^Mouse(\d)$/);
  return m ? [MOUSE_VK[m[1]], Number(m[1])] : [vkFor(k), 0];
}

/** Virtual key code for a binding, 0 = not set / not usable. */
function vkFor(bind) {
  const b = String(bind || '').trim();
  if (!b) return 0;
  if (VK[b] != null) return VK[b];
  if (/^[a-z0-9]$/i.test(b)) return b.toUpperCase().charCodeAt(0);
  const f = b.match(/^F([1-9]|1[0-9]|2[0-4])$/i);
  if (f) return 0x6F + Number(f[1]);                    // F1 = 0x70
  return 0;
}

/** How it reads in the settings. */
const label = (bind) => (/^Mouse\d$/.test(String(bind || '')) ? 'Mouse ' + bind.slice(5) : String(bind || 'not set'));

/** Seconds between two presses of a key -> milliseconds (0.1–60 s). */
const loopMsFor = (sec) => Math.round(1000 * Math.max(0.1, Math.min(60, Number(sec) || 1)));

/**
 * Lock: the list [{ key, lock, sec }] as [key code, mouse button, ms] – ms 0 = held down, else
 * pressed again every ms. In the user's order (the priority of the timed ones), each key once
 * (the first entry wins), unknown keys left out. lock is on unless it is false; a key switched
 * off for now (off: true) is left out.
 */
const lockItems = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((e) => {
    const k = keyOf(e && e.key);
    if (!k || seen.has(e.key)) return null;
    seen.add(e.key);
    if (e.off === true) return null;
    return [k[0], k[1], e.lock === false ? loopMsFor(e.sec) : 0];
  }).filter(Boolean);
};

/** Clicks per second -> milliseconds between clicks (1–40 per second). */
const delayFor = (cps) => Math.round(1000 / Math.max(1, Math.min(40, Number(cps) || 15)));

const psString = (s) => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";

/**
 * The helper. All triggers are polled in one loop; a binding of 0 is simply never down.
 */
function script(o) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class Clicker {
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  // INPUT is a union; MOUSEINPUT is its largest member, so this layout has the right size.
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public MOUSEINPUT mi; }
  // The keyboard variant, padded to the same size as the mouse one.
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; public uint pad1; public uint pad2; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUTK { public uint type; public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUTK[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);

  const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
  const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, XDOWN = 0x0080, XUP = 0x0100;

  static volatile bool quit = false;

  static bool Down(int vk) { return vk != 0 && (GetAsyncKeyState(vk) & 0x8000) != 0; }

  static bool Active(string title, string proc) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return false;
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    string t = sb.ToString().Trim();
    if (title.Length > 0 && string.Equals(t, title, StringComparison.OrdinalIgnoreCase)) return true;
    if (proc.Length == 0) return false;
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { return string.Equals(Process.GetProcessById((int)pid).ProcessName, proc, StringComparison.OrdinalIgnoreCase); }
    catch { return false; }
  }

  static void Send(uint flag, uint data) {
    INPUT[] e = new INPUT[1];
    e[0].type = 0; e[0].mi.dwFlags = flag; e[0].mi.mouseData = data;
    SendInput(1, e, Marshal.SizeOf(typeof(INPUT)));
  }

  // A game reads the mouse once per frame. Down and up in the same moment can fall into one
  // frame and be dropped, so the button is held for a short while – that is what makes the
  // clicks count inside Diablo IV and not just in a normal window.
  static void Click(uint down, uint up, int holdMs) {
    Send(down, 0);
    Thread.Sleep(holdMs);
    Send(up, 0);
  }

  // Games read the scan code, not the virtual key, so the key is sent as a scan code.
  static void KeyEdge(int vk, bool down) {
    INPUTK[] e = new INPUTK[1];
    e[0].type = 1; e[0].ki.wScan = (ushort)MapVirtualKey((uint)vk, 0); e[0].ki.dwFlags = 0x0008 | (down ? 0u : 0x0002u);
    SendInput(1, e, Marshal.SizeOf(typeof(INPUTK)));
  }
  static void Key(int vk, int holdMs) { KeyEdge(vk, true); Thread.Sleep(holdMs); KeyEdge(vk, false); }

  // one mouse button down or up: 1 left, 2 right, 3 wheel, 4 / 5 the thumb buttons
  static void MouseEdge(int button, bool down) {
    switch (button) {
      case 1: Send(down ? LEFTDOWN : LEFTUP, 0); break;
      case 2: Send(down ? RIGHTDOWN : RIGHTUP, 0); break;
      case 3: Send(down ? MIDDLEDOWN : MIDDLEUP, 0); break;
      case 4: Send(down ? XDOWN : XUP, 1); break;
      case 5: Send(down ? XDOWN : XUP, 2); break;
    }
  }

  static void Say(string json) { Console.WriteLine(json); Console.Out.Flush(); }

  // Windows sleeps in steps of about 15 ms unless asked for 1 ms – without it Sleep(5) is 15
  // and every pause and click rate here is uneven.
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
  [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);

  // The toggle key is watched on its own thread: the main loop can be busy for a while (a timed
  // key, a click), and a short press – a tap on the wheel button – would fall in between.
  static volatile int lockPresses = 0;
  static void WatchToggle(object o) {
    int key = (int)o;
    bool was = false;
    while (!quit) {
      bool d = Down(key);
      if (d && !was) lockPresses++;
      was = d;
      Thread.Sleep(4);
    }
  }

  static bool ParentAlive(int pid) {
    if (pid <= 0) return true;
    try { return !Process.GetProcessById(pid).HasExited; } catch { return false; }
  }

  // A left click or Space by hand pauses lock. GetAsyncKeyState cannot tell them from the input
  // sent here (lock can hold or press Mouse 1 and Space itself), low level hooks can: sent input
  // is flagged.
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)]
  struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr extra; }
  static HookProc hookFn;                       // kept, so the collector does not take it
  static IntPtr hook = IntPtr.Zero;
  static volatile bool handLeft = false;
  static HookProc keyFn;
  static IntPtr keyHook = IntPtr.Zero;
  static volatile bool handSpace = false;
  static IntPtr OnKey(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(KBDLLHOOKSTRUCT));
      if (k.vkCode == 0x20 && (k.flags & 0x10) == 0) {    // Space, flag 0x10 = injected: ours, not the hand
        int m = (int)w;
        if (m == 0x0100 || m == 0x0104) handSpace = true;          // key down (also with Alt)
        else if (m == 0x0101 || m == 0x0105) handSpace = false;    // key up
      }
    }
    return CallNextHookEx(keyHook, code, w, l);
  }
  static IntPtr OnMouse(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      int m = (int)w;
      if (m == 0x0201 || m == 0x0202) {         // left down / up
        MSLLHOOKSTRUCT s = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
        if ((s.flags & 1) == 0) handLeft = m == 0x0201;     // flag 1 = injected: ours, not the hand
      }
    }
    return CallNextHookEx(hook, code, w, l);
  }
  static void WatchHand() {
    hookFn = OnMouse;
    hook = SetWindowsHookEx(14, hookFn, GetModuleHandle(null), 0);    // WH_MOUSE_LL
    if (hook == IntPtr.Zero) Say("{\\"hook\\":false}");
    keyFn = OnKey;
    keyHook = SetWindowsHookEx(13, keyFn, GetModuleHandle(null), 0);  // WH_KEYBOARD_LL
    if (keyHook == IntPtr.Zero) Say("{\\"keyhook\\":false}");
    if (hook == IntPtr.Zero && keyHook == IntPtr.Zero) return;
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
  }

  // lockKeys: "vk:ms:button,…" – ms 0 = held down, else pressed every ms; button 0 = a key
  public static void Run(int vkL, int vkR, int delayMs, int vkLock, string lockKeys,
                         string title, string proc, int parentPid) {
    // the overlay closes stdin to stop the helper – whatever is held is let go first
    Thread watch = new Thread(() => { try { while (Console.In.ReadLine() != null) { } } catch { } quit = true; });
    watch.IsBackground = true;
    watch.Start();

    string[] parts = lockKeys.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
    int n = parts.Length;
    int[] vk = new int[n], btn = new int[n], every = new int[n], last = new int[n];
    for (int i = 0; i < n; i++) {
      string[] kv = parts[i].Split(':');
      vk[i] = int.Parse(kv[0]);
      every[i] = kv.Length > 1 ? int.Parse(kv[1]) : 0;
      btn[i] = kv.Length > 2 ? int.Parse(kv[2]) : 0;
    }
    if (n == 0) vkLock = 0;
    if (vkLock != 0) {
      Thread mouse = new Thread(WatchHand);
      mouse.IsBackground = true;
      mouse.Start();
      Thread toggle = new Thread(WatchToggle);
      toggle.IsBackground = true;
      toggle.Start(vkLock);
    }
    timeBeginPeriod(1);

    bool running = false, locking = false, pressed = false, inGame = false, paused = false;
    int seenPresses = 0;
    int tick = 0, checkedAt = 0, pressedAt = 0, repeatAt = 0, handUpAt = Environment.TickCount - 1000;

    int hold = Math.Max(20, Math.Min(40, delayMs / 2));      // how long a clicked button stays down
    int rest = Math.Max(5, delayMs - hold);
    try {
      while (true) {
        if (quit) return;
        if (++tick >= 200) { tick = 0; if (!ParentAlive(parentPid)) return; }   // overlay gone -> stop
        bool l = Down(vkL), r = Down(vkR);
        bool spam = (l || r) && Active(title, proc);

        // lock's toggle key: one press switches it on, the next one off (counted by WatchToggle)
        int presses = lockPresses;
        if (presses != seenPresses) {
          if (((presses - seenPresses) & 1) == 1) locking = !locking;
          seenPresses = presses;
          for (int i = 0; i < n; i++) last[i] = Environment.TickCount - every[i];   // the timed ones go out at once
          checkedAt = Environment.TickCount - 1000;
          Say(locking ? "{\\"lock\\":true}" : "{\\"lock\\":false}");
        }
        if (locking && unchecked(Environment.TickCount - checkedAt) >= 100) { checkedAt = Environment.TickCount; inGame = Active(title, proc); }

        // a left click or Space by hand, or left click spam: lock waits until it is let go – and a
        // moment more, so the short gaps of clicking again and again do not start it in between
        if (handLeft && !Down(0x01)) handLeft = false;         // an up the hook missed
        if (handSpace && !Down(0x20)) handSpace = false;
        bool hand = handLeft || handSpace || (spam && l);
        if (hand) handUpAt = Environment.TickCount;
        bool pause = locking && inGame && (hand || unchecked(Environment.TickCount - handUpAt) < 250);
        if (pause != paused) { paused = pause; Say(paused ? "{\\"pause\\":true}" : "{\\"pause\\":false}"); }

        if (locking && inGame && !paused) {
          // the timed keys first, in the user's order. What is held stays down: letting go and
          // pressing again would break off a held skill every time – the game takes the new key
          // on top and goes on with the held one. Each tap lasts a few frames (60 ms), so a slow
          // or stuttering frame cannot swallow it.
          for (int i = 0; i < n; i++) {
            if (handLeft || handSpace) break;                  // pressed meanwhile: stop at once
            if (every[i] == 0 || unchecked(Environment.TickCount - last[i]) < every[i]) continue;
            last[i] = Environment.TickCount;
            if (btn[i] > 0) { MouseEdge(btn[i], true); Thread.Sleep(60); MouseEdge(btn[i], false); }
            else Key(vk[i], 60);
            Thread.Sleep(30);
          }
          int now = Environment.TickCount;
          if (!pressed) {
            bool any = false;
            for (int i = 0; i < n; i++) {
              if (every[i] != 0) continue;
              any = true;
              if (btn[i] > 0) MouseEdge(btn[i], true); else KeyEdge(vk[i], true);
            }
            if (any) { pressed = true; pressedAt = now; repeatAt = now + 300; }
          } else {
            // a key held on a real keyboard repeats: after a short pause about 30 times a second.
            // Games that act on those repeats (a skill cast again and again) need them too –
            // one key down alone reads as a single press there.
            if (unchecked(now - repeatAt) >= 0) {
              for (int i = 0; i < n; i++) if (every[i] == 0 && btn[i] == 0) KeyEdge(vk[i], true);
              repeatAt = now + 33;
            }
            // mouse buttons do not repeat; one that came loose goes down again
            if (unchecked(now - pressedAt) >= 250) {
              for (int i = 0; i < n; i++) if (every[i] == 0 && btn[i] > 0 && !Down(vk[i])) MouseEdge(btn[i], true);
              pressedAt = now;
            }
          }
        } else if (pressed) {
          Release(vk, btn, every); pressed = false;
        }

        if (spam) {
          if (!running) { running = true; Say("{\\"spam\\":true,\\"button\\":\\"" + (l ? "left" : "right") + "\\"}"); }
          if (l) Click(LEFTDOWN, LEFTUP, hold);
          if (r) Click(RIGHTDOWN, RIGHTUP, hold);
          Thread.Sleep(rest);
          continue;
        }
        if (running) { running = false; Say("{\\"spam\\":false}"); }
        Thread.Sleep(5);
      }
    } finally {
      if (pressed) Release(vk, btn, every);
      timeEndPeriod(1);
    }
  }

  // lets go of the held keys (the timed ones are never left down)
  static void Release(int[] vk, int[] btn, int[] every) {
    for (int i = 0; i < vk.Length; i++) {
      if (every[i] != 0) continue;
      if (btn[i] > 0) MouseEdge(btn[i], false); else KeyEdge(vk[i], false);
    }
  }
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Write-Output '{"ready":true}'      # compiling the helper takes a moment
[Clicker]::Run(${o.vkLeft | 0}, ${o.vkRight | 0}, ${o.delayMs | 0}, ${o.vkLock | 0}, ${psString(o.lockItems.map((k) => (k[0] | 0) + ':' + (k[2] | 0) + ':' + (k[1] | 0)).join(','))}, ${psString(o.title)}, ${psString(o.proc)}, ${o.parentPid | 0})
`;
}

let ps = null;

/**
 * The helper as it goes on the command line: -EncodedCommand is UTF-16 in base64 and Windows
 * allows 32767 characters, which the commented script is past. Indents and // comment lines go,
 * the code stays the same.
 */
function encoded(o) {
  const s = script(o).split('\n').map((l) => l.replace(/^\s+/, '')).filter((l) => !l.startsWith('//'))
    .map((l) => l.replace(/\s+\/\/ .*$/, '')).join('\n');
  return Buffer.from(s, 'utf16le').toString('base64');
}

/**
 * What the helper would be started with – also used by the settings to explain itself.
 * Every macro is off unless switched on (true), and none runs when the build leaves it out.
 * @param {boolean|object} enabled  what the build has: false = none, or { clickSpam, lock }
 */
function plan(settings, procName, enabled = true) {
  const has = typeof enabled === 'object' && enabled
    ? { clickSpam: !!enabled.clickSpam, lock: !!enabled.lock }
    : { clickSpam: !!enabled, lock: !!enabled };
  const on = has.clickSpam && settings.clickSpam === true;
  const vkLeft = on ? vkFor(settings.clickLeftBind) : 0;
  const vkRight = on ? vkFor(settings.clickRightBind) : 0;
  const items = lockItems(settings.lockKeys);
  const vkLock = has.lock && settings.lockOn === true && items.length ? vkFor(settings.lockBind) : 0;
  return {
    on, vkLeft, vkRight, vkLock,
    lockItems: vkLock ? items : [],
    delayMs: delayFor(settings.clickCps),
    title: String(settings.d4WindowTitle || '').trim(),
    proc: String(procName || '').trim(),
    parentPid: process.pid,
    usable: (on && (vkLeft || vkRight) > 0) || vkLock > 0,
  };
}

/**
 * Starts (or restarts) the helper. Returns what it was started with, so the caller can log it.
 * @param {object} settings  the overlay settings
 * @param {string} procName  process name of the game window (e.g. "Diablo IV")
 * @param {function} log
 * @param {object} on        { spam(on, button), lock(on), pause(on) } – what the helper reports
 * @param {boolean|object} enabled  what the build has (see plan)
 */
function start(settings, procName, log, on, enabled = true) {
  stop();
  const p = plan(settings, procName, enabled);
  if (process.platform !== 'win32' || !p.usable) return p;

  const enc = encoded(p);
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const s = JSON.parse(line);
        if (s.ready) { if (log) log('macro helper ready'); continue; }
        if ('lock' in s) { if (on && on.lock) on.lock(!!s.lock); continue; }
        if ('pause' in s) { if (on && on.pause) on.pause(!!s.pause); continue; }
        if ('hook' in s) { if (log) log('macro helper: no mouse hook – a left click by hand does not pause lock'); continue; }
        if ('keyhook' in s) { if (log) log('macro helper: no keyboard hook – Space by hand does not pause lock'); continue; }
        if (on && on.spam) on.spam(!!s.spam, s.button || '');
      } catch (_) { /* half a line */ }
    }
  });
  ps.stderr.on('data', (d) => {
    const t = String(d).replace(/#<\s*CLIXML[\s\S]*$/i, '').trim();
    if (t && log) log('macro helper:', t.slice(0, 200));
  });
  ps.stdin.on('error', () => { /* already gone */ });
  ps.on('error', (e) => { if (log) log('macro helper failed:', e.message); });
  return p;
}

/** Stops the helper: closing its stdin lets it release what it holds, then it is ended for sure. */
function stop() {
  const p = ps;
  ps = null;
  if (!p) return;
  try { p.stdin.end(); } catch (_) {}
  const t = setTimeout(() => { try { p.kill(); } catch (_) {} }, 1500);
  if (t.unref) t.unref();
  p.on('exit', () => clearTimeout(t));
}

const running = () => !!ps;

module.exports = {
  start, stop, running, plan, script, encoded, vkFor, keyOf, label, delayFor, loopMsFor, lockItems,
  VK, KEY_CHOICES,
};
