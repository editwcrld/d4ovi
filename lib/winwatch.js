'use strict';
// Watches the foreground window (title, process name) through ONE PowerShell process that keeps running.
// No native module needed -> easy to ship.
const { spawn } = require('child_process');

function script(names) {
  const list = names.map((n) => "'" + String(n).replace(/'/g, "''") + "'").join(',');
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$names = @(${list})
while ($true) {
  $h = [FG]::GetForegroundWindow()
  $wpid = [FG]::Pid($h)
  $proc = ''
  $p = Get-Process -Id $wpid
  if ($p) { $proc = $p.ProcessName }
  $running = (@(Get-Process -Name $names)).Count -gt 0
  @{ title = [FG]::Title($h); proc = $proc; pid = [int]$wpid; running = [bool]$running } | ConvertTo-Json -Compress
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

function startWatcher(processNames, onState, onError) {
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
      try { onState(JSON.parse(line)); } catch (_) { /* an incomplete line */ }
    }
  });
  ps.stderr.on('data', (d) => {
    const t = onError && unwrapPsError(d);
    if (t) onError(new Error(t));
  });
  ps.on('error', (e) => onError && onError(e));
  return () => { try { ps.kill(); } catch (_) {} };
}

module.exports = { startWatcher, unwrapPsError };
