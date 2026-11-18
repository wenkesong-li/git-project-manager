import { api } from './api';
import { applyTheme } from './themes';
export function readPreferences() {
  let editor = {}; try { editor = JSON.parse(localStorage.getItem('gpm-editor') || '{}'); } catch {}
  return { theme: localStorage.getItem('gpm-theme') || 'neutral', fontScale: Number(localStorage.getItem('gpm-font') || 100), radius: Number(localStorage.getItem('gpm-radius') || 4), sidebarWidth: Number(localStorage.getItem('gpm-sidebar-width') || 232), startup: localStorage.getItem('gpm-startup') || 'last', editor: { fontSize: 13, wordWrap: false, minimap: false, ...editor } };
}
export function applyPreferences(preferences) {
  if (preferences.theme) applyTheme(preferences.theme);
  for (const [field, key] of [['fontScale','gpm-font'],['radius','gpm-radius'],['sidebarWidth','gpm-sidebar-width'],['startup','gpm-startup']]) if (preferences[field] !== undefined) localStorage.setItem(key, String(preferences[field]));
  if (preferences.editor) localStorage.setItem('gpm-editor', JSON.stringify({ ...readPreferences().editor, ...preferences.editor }));
  const current = readPreferences();
  document.documentElement.style.setProperty('--ui-scale', current.fontScale / 100);
  document.documentElement.style.setProperty('--ui-radius', `${current.radius}px`);
  window.dispatchEvent(new Event('gitpm:preferences'));
}
export async function savePreferences(preferences) { const result = await api('PUT', '/api/preferences', { preferences }); applyPreferences(result.preferences); return result.preferences; }
