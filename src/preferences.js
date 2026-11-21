import { api } from './api';
import { applyTheme } from './themes';
import sanitizeWallpaper from '../server/wallpaper';
export function readPreferences() {
  let editor = {}; try { editor = JSON.parse(localStorage.getItem('gpm-editor') || '{}'); } catch {}
  let shortcuts = {}; try { shortcuts = JSON.parse(localStorage.getItem('gpm-shortcuts') || '{}') || {}; } catch {}
  let wallpaper = null; try { wallpaper = sanitizeWallpaper(JSON.parse(localStorage.getItem("gpm-wallpaper") || "null")); } catch {}
  return { wallpaper, shortcuts, theme: localStorage.getItem('gpm-theme') || 'neutral', fontScale: Number(localStorage.getItem('gpm-font') || 100), radius: Number(localStorage.getItem('gpm-radius') || 4), sidebarWidth: Number(localStorage.getItem('gpm-sidebar-width') || 232), startup: localStorage.getItem('gpm-startup') || 'last', editor: { fontSize: 13, wordWrap: false, lineNumbers: true, ...editor } };
}
export function applyPreferences(preferences) {
  if (preferences.theme) applyTheme(preferences.theme);
  for (const [field, key] of [['fontScale','gpm-font'],['radius','gpm-radius'],['sidebarWidth','gpm-sidebar-width'],['startup','gpm-startup']]) if (preferences[field] !== undefined) localStorage.setItem(key, String(preferences[field]));
  if (preferences.editor) localStorage.setItem('gpm-editor', JSON.stringify({ ...readPreferences().editor, ...preferences.editor }));
  if (preferences.shortcuts !== undefined) localStorage.setItem('gpm-shortcuts', JSON.stringify(preferences.shortcuts));
  if (preferences.wallpaper !== undefined) localStorage.setItem('gpm-wallpaper', JSON.stringify(sanitizeWallpaper(preferences.wallpaper)));
  const current = readPreferences();
  const wallpaper = current.wallpaper;
  if (wallpaper) {
    document.body.dataset.wallpaper = wallpaper.area;
    document.body.dataset.wallpaperLayout = wallpaper.layout;
    document.body.style.setProperty('--wallpaper-image', 'url("' + wallpaper.image + '")');
    document.body.style.setProperty('--wallpaper-opacity', wallpaper.opacity + '%');
  } else {
    delete document.body.dataset.wallpaper;
    delete document.body.dataset.wallpaperLayout;
    document.body.style.removeProperty('--wallpaper-image');
    document.body.style.removeProperty('--wallpaper-opacity');
  }
  document.documentElement.style.setProperty('--ui-scale', current.fontScale / 100);
  document.documentElement.style.setProperty('--ui-radius', `${current.radius}px`);
  window.dispatchEvent(new Event('gitpm:preferences'));
}
export async function savePreferences(preferences) { const result = await api('PUT', '/api/preferences', { preferences }); applyPreferences(result.preferences); return result.preferences; }
