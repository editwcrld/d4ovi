'use strict';
// The icon in the Windows tray: show or hide the overlay, open a section, check for updates, quit
// – without the bar having to be on screen. A click on the icon shows / hides the overlay.
const { Tray, Menu, nativeImage } = require('electron');

let tray = null;

/** The app has no icon file – a small amber ring with a dot, drawn here (BGRA). */
function icon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      const ring = d > 0.68 && d < 0.95, dot = d < 0.36;
      if (!ring && !dot) continue;
      const i = (y * size + x) * 4;
      buf[i] = 0x4a; buf[i + 1] = 0xa0; buf[i + 2] = 0xe3; buf[i + 3] = 0xff;   // #e3a04a
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

/**
 * @param {object} o
 * @param {() => boolean} o.hidden      is the overlay hidden by hand?
 * @param {(on: boolean) => void} o.setHidden
 * @param {(name: string) => void} o.open   opens a section of the overlay
 * @param {() => void} o.launch        starts the game (its launcher)
 * @param {() => void} o.checkUpdates
 * @param {() => void} o.quit
 */
function create(o) {
  if (tray) return tray;
  tray = new Tray(icon());
  tray.setToolTip('D4ovi');
  const menu = () => Menu.buildFromTemplate([
    { label: 'D4ovi', enabled: false },            // which app this menu belongs to
    { type: 'separator' },
    { label: 'Start Diablo IV', click: () => o.launch() },
    { type: 'separator' },
    { label: o.hidden() ? 'Show the overlay' : 'Hide the overlay', click: () => { o.setHidden(!o.hidden()); refresh(); } },
    { type: 'separator' },
    { label: 'Search', click: () => o.open('search') },
    { label: 'Builds', click: () => o.open('farm') },
    { label: 'Notes', click: () => o.open('notes') },
    { label: 'Settings', click: () => o.open('settings') },
    { type: 'separator' },
    { label: 'Check for updates', click: () => o.checkUpdates() },
    { label: 'Quit', click: () => o.quit() },
  ]);
  const refresh = () => { if (tray && !tray.isDestroyed()) tray.setContextMenu(menu()); };
  tray.on('click', () => { o.setHidden(!o.hidden()); refresh(); });
  refresh();
  create.refresh = refresh;
  return tray;
}
const refresh = () => { if (create.refresh) create.refresh(); };
function destroy() { if (tray && !tray.isDestroyed()) tray.destroy(); tray = null; }

module.exports = { create, refresh, destroy, icon };
