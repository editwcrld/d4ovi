'use strict';
// Rapid clicking while a button is held down – and only while Diablo IV is the active window.
//
// Node cannot read a held mouse button or send clicks on Windows, and a native module would
// break the portable build. So one small PowerShell helper does it (same approach as
// lib/winwatch.js): it polls the trigger, checks the foreground window and sends the clicks.
// It also watches the overlay's process id, so it can never stay behind as a stray clicker.
//
// The same helper runs the key loop: a toggle key switches it on, then it presses the chosen
// skill keys (1–4) one after the other, again every few seconds – also only in the game.
const { spawn } = require('child_process');
const { unwrapPsError } = require('./winwatch');

// Triggers that can be bound, with their Windows virtual key codes.
// Mouse4/Mouse5 are the two thumb buttons (XBUTTON1/XBUTTON2).
const VK = {
  Mouse3: 0x04, Mouse4: 0x05, Mouse5: 0x06,
  Space: 0x20, CapsLock: 0x14, Tab: 0x09,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28, Insert: 0x2D, Delete: 0x2E,
  '`': 0xC0, '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD, '\\': 0xDC,
  ';': 0xBA, "'": 0xDE, ',': 0xBC, '.': 0xBE, '/': 0xBF,
};

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

/** Seconds between two rounds of the key loop -> milliseconds (0.1–60 s). */
const loopMsFor = (sec) => Math.round(1000 * Math.max(0.1, Math.min(60, Number(sec) || 1)));

/** The skill keys of the loop as key codes – only 1 to 4, each once, in that order. */
const loopKeys = (keys) => Array.from(new Set(String(keys || '').replace(/[^1-4]/g, '').split('')))
  .sort().map((k) => k.charCodeAt(0));

/** Clicks per second -> milliseconds between clicks (1–40 per second). */
const delayFor = (cps) => Math.round(1000 / Math.max(1, Math.min(40, Number(cps) || 15)));

const psString = (s) => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";

/**
 * The helper. Both triggers are polled in one loop; a binding of 0 is simply never down.
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

  static void Send(uint flag) {
    INPUT[] e = new INPUT[1];
    e[0].type = 0; e[0].mi.dwFlags = flag;
    SendInput(1, e, Marshal.SizeOf(typeof(INPUT)));
  }

  // A game reads the mouse once per frame. Down and up in the same moment can fall into one
  // frame and be dropped, so the button is held for a short while – that is what makes the
  // clicks count inside Diablo IV and not just in a normal window.
  static void Click(uint down, uint up, int holdMs) {
    Send(down);
    Thread.Sleep(holdMs);
    Send(up);
  }

  // Games read the scan code, not the virtual key, so the key is sent as a scan code.
  static void Key(int vk, int holdMs) {
    INPUTK[] e = new INPUTK[1];
    e[0].type = 1; e[0].ki.wScan = (ushort)MapVirtualKey((uint)vk, 0); e[0].ki.dwFlags = 0x0008;
    SendInput(1, e, Marshal.SizeOf(typeof(INPUTK)));
    Thread.Sleep(holdMs);
    e[0].ki.dwFlags = 0x0008 | 0x0002;
    SendInput(1, e, Marshal.SizeOf(typeof(INPUTK)));
  }

  static void Say(string json) { Console.WriteLine(json); Console.Out.Flush(); }

  static bool ParentAlive(int pid) {
    if (pid <= 0) return true;
    try { return !Process.GetProcessById(pid).HasExited; } catch { return false; }
  }

  public static void Run(int vkL, int vkR, int delayMs, int vkLoop, string loopKeys, int loopMs, string title, string proc, int parentPid) {
    bool running = false;
    int tick = 0;
    bool looping = false, loopWas = false;
    int lastRound = 0;
    string[] parts = loopKeys.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
    int[] keys = new int[parts.Length];
    for (int i = 0; i < parts.Length; i++) keys[i] = int.Parse(parts[i]);
    if (keys.Length == 0) vkLoop = 0;
    int hold = Math.Max(20, Math.Min(40, delayMs / 2));      // how long a button stays down
    int rest = Math.Max(5, delayMs - hold);
    while (true) {
      if (++tick >= 200) { tick = 0; if (!ParentAlive(parentPid)) return; }   // overlay gone -> stop
      // the toggle key: one press switches the loop on, the next one off
      bool t = Down(vkLoop);
      if (t && !loopWas) { looping = !looping; lastRound = Environment.TickCount - loopMs; Say(looping ? "{\\"loop\\":true}" : "{\\"loop\\":false}"); }
      loopWas = t;
      if (looping && unchecked(Environment.TickCount - lastRound) >= loopMs && Active(title, proc)) {
        lastRound = Environment.TickCount;
        foreach (int k in keys) { Key(k, 30); Thread.Sleep(40); }
      }
      bool l = Down(vkL), r = Down(vkR);
      if ((l || r) && Active(title, proc)) {
        if (!running) { running = true; Console.WriteLine("{\\"spam\\":true,\\"button\\":\\"" + (l ? "left" : "right") + "\\"}"); Console.Out.Flush(); }
        if (l) Click(LEFTDOWN, LEFTUP, hold);
        if (r) Click(RIGHTDOWN, RIGHTUP, hold);
        Thread.Sleep(rest);
        continue;
      }
      if (running) { running = false; Console.WriteLine("{\\"spam\\":false}"); Console.Out.Flush(); }
      Thread.Sleep(5);
    }
  }
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Write-Output '{"ready":true}'      # compiling the helper takes a moment
[Clicker]::Run(${o.vkLeft | 0}, ${o.vkRight | 0}, ${o.delayMs | 0}, ${o.vkLoop | 0}, ${psString(o.loopKeys.join(','))}, ${o.loopMs | 0}, ${psString(o.title)}, ${psString(o.proc)}, ${o.parentPid | 0})
`;
}

let ps = null;

/** What the helper would be started with – also used by the settings to explain itself. */
function plan(settings, procName) {
  const on = settings.clickSpam !== false;
  const vkLeft = on ? vkFor(settings.clickLeftBind) : 0;
  const vkRight = on ? vkFor(settings.clickRightBind) : 0;
  const keys = loopKeys(settings.keyLoopKeys);
  const vkLoop = settings.keyLoop !== false && keys.length ? vkFor(settings.keyLoopBind) : 0;
  return {
    on, vkLeft, vkRight, vkLoop,
    loopKeys: vkLoop ? keys : [],
    loopMs: loopMsFor(settings.keyLoopSec),
    delayMs: delayFor(settings.clickCps),
    title: String(settings.d4WindowTitle || '').trim(),
    proc: String(procName || '').trim(),
    parentPid: process.pid,
    usable: (on && (vkLeft || vkRight) > 0) || vkLoop > 0,
  };
}

/**
 * Starts (or restarts) the helper. Returns what it was started with, so the caller can log it.
 * @param {object} settings  the overlay settings
 * @param {string} procName  process name of the game window (e.g. "Diablo IV")
 * @param {function} log
 * @param {function} onState called with true/false while clicks are being sent
 * @param {function} onLoop  called with true/false when the key loop is switched
 */
function start(settings, procName, log, onState, onLoop) {
  stop();
  const p = plan(settings, procName);
  if (process.platform !== 'win32' || !p.usable) return p;

  const enc = Buffer.from(script(p), 'utf16le').toString('base64');
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
        if (s.ready) { if (log) log('click spam helper ready'); continue; }
        if ('loop' in s) { if (onLoop) onLoop(!!s.loop); continue; }
        if (onState) onState(!!s.spam, s.button || '');
      } catch (_) { /* half a line */ }
    }
  });
  ps.stderr.on('data', (d) => {
    const t = String(d).replace(/#<\s*CLIXML[\s\S]*$/i, '').trim();
    if (t && log) log('click spam helper:', t.slice(0, 200));
  });
  ps.on('error', (e) => { if (log) log('click spam helper failed:', e.message); });
  return p;
}

function stop() {
  if (ps) { try { ps.kill(); } catch (_) {} }
  ps = null;
}

const running = () => !!ps;

module.exports = { start, stop, running, plan, script, vkFor, label, delayFor, loopMsFor, loopKeys, VK };
