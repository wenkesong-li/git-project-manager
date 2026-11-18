'use strict';
const path = require('path');
const os = require('os');

function resolvePaths(env = process.env, runtime = process) {
  const appRoot = path.resolve(__dirname, '..');
  const desktop = env.GITPM_DESKTOP === '1' || !!runtime.versions?.electron || appRoot.includes('app.asar');
  return {
    APP_ROOT: appRoot,
    DATA_DIR: env.GITPM_DATA_DIR ? path.resolve(env.GITPM_DATA_DIR) : path.join(os.homedir(), '.gitpm'),
    DEFAULT_WORKSPACE: env.GITPM_WORKSPACE ? path.resolve(env.GITPM_WORKSPACE) : desktop ? path.join(os.homedir(), 'GitProjects') : path.join(appRoot, 'repos'),
  };
}
module.exports = { ...resolvePaths(), resolvePaths };
