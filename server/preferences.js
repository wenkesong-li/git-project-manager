'use strict';
const themes = ['neutral','bluewhite','reactbits','dark','midnight','forest','light','sand','lavender'];
module.exports = function sanitize(input = {}) {
  const result = {};
  if (themes.includes(input.theme)) result.theme = input.theme;
  if ([100,110,125].includes(Number(input.fontScale))) result.fontScale = Number(input.fontScale);
  if ([2,4,6,10].includes(Number(input.radius))) result.radius = Number(input.radius);
  if (Number.isFinite(input.sidebarWidth) && input.sidebarWidth >= 180 && input.sidebarWidth <= 600) result.sidebarWidth = input.sidebarWidth;
  if (['home','last'].includes(input.startup)) result.startup = input.startup;
  if (typeof input.lastRoute === 'string' && /^#\/(?:project\/\d+)?$/.test(input.lastRoute)) result.lastRoute = input.lastRoute;
  if (input.editor && typeof input.editor === 'object') {
    const editor = {};
    if (Number.isFinite(Number(input.editor.fontSize)) && Number(input.editor.fontSize) >= 10 && Number(input.editor.fontSize) <= 24) editor.fontSize = Number(input.editor.fontSize);
    if (typeof input.editor.wordWrap === 'boolean') editor.wordWrap = input.editor.wordWrap;
    if (typeof input.editor.minimap === 'boolean') editor.minimap = input.editor.minimap;
    result.editor = editor;
  }
  return result;
};
