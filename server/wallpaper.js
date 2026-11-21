'use strict';

function sanitizeWallpaper(value) {
  const image = value?.image;
  if (typeof image !== 'string' || image.length > 450000 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(image)) return null;
  const opacity = Number(value.opacity);
  return {
    image,
    area: ['sidebar', 'workspace', 'both'].includes(value.area) ? value.area : 'both',
    layout: value.layout === 'separate' ? 'separate' : 'continuous',
    opacity: Number.isFinite(opacity) ? Math.max(5, Math.min(40, Math.round(opacity))) : 22,
  };
}

module.exports = sanitizeWallpaper;
