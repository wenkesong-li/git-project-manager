'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const directory = path.resolve(__dirname, '../test');
const tests = fs.readdirSync(directory).filter(name => name.endsWith('.test.js')).map(name => path.join(directory, name));
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status || 0;
