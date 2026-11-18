'use strict';

// -z 保留中文、引号、换行及含「 -> 」的真实文件名。
function parseStatus(output) {
  const records = output.split('\0');
  const items = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const x = record[0];
    const y = record[1];
    const file = record.slice(3);
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
    const conflict = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(x + y);
    const state = conflict ? 'conflict' : x === '?' || x === 'A' || y === 'A' ? 'added'
      : x === 'D' || y === 'D' ? 'deleted' : 'modified';
    items.push({ path: file, state, staged: x !== ' ' && x !== '?' && !conflict });
  }
  return items;
}

module.exports = { parseStatus };
