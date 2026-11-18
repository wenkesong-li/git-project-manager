'use strict';
module.exports = (add, ctx) => {
  const service = require('../configuration')(ctx);
  add('GET', '/api/configuration/onboarding', async () => service.onboarding());
  add('POST', '/api/configuration/finish', async () => service.finish());
  add('POST', '/api/configuration/legacy-preview', async ({ body }) => service.inspectLegacy(body.path));
  add('POST', '/api/configuration/legacy-import', async ({ body }) => service.importLegacy(body.path));
  add('POST', '/api/configuration/export', async ({ body }) => service.export(body));
  add('POST', '/api/configuration/preview', async ({ body }) => service.inspectBackup(body.backup, body.password));
  add('POST', '/api/configuration/import', async ({ body }) => service.importBackup(body.backup, body.password));
};
