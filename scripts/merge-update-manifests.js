'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const root = path.resolve(process.argv[2] || 'release-assets');
const manifests = new Map();
for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  const source = path.join(root, directory.name);
  for (const name of fs.readdirSync(source)) {
    if (name.endsWith('.yml')) {
      const data = YAML.parse(fs.readFileSync(path.join(source, name), 'utf8'));
      const previous = manifests.get(name);
      if (previous && previous.version !== data.version) throw new Error('安装包版本不一致');
      manifests.set(name, { ...data, files: [...(previous?.files || []), ...(data.files || [])].filter((file, index, items) => items.findIndex(item => item.url === file.url) === index) });
    } else fs.copyFileSync(path.join(source, name), path.join(root, name));
  }
}
for (const [name, data] of manifests) fs.writeFileSync(path.join(root, name), YAML.stringify(data));
