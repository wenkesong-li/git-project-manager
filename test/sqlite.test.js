'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('database adapter supports rows, IDs and nested transaction rollback', () => {
  const db = new (require('../server/sqlite'))(':memory:');
  try {
    db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT)');
    assert.equal(Number(db.prepare('INSERT INTO sample(value) VALUES(?)').run('first').lastInsertRowid), 1);
    assert.deepEqual(db.prepare('SELECT * FROM sample').all(), [{ id: 1, value: 'first' }]);
    assert.throws(db.transaction(() => { db.prepare('INSERT INTO sample(value) VALUES(?)').run('rollback'); throw new Error('rollback'); }), /rollback/);
    db.transaction(() => { db.prepare('INSERT INTO sample(value) VALUES(?)').run('second'); assert.throws(db.transaction(() => { db.prepare('INSERT INTO sample(value) VALUES(?)').run('nested'); throw new Error('nested'); })); })();
    assert.equal(db.prepare('SELECT count(*) AS total FROM sample').get().total, 2);
  } finally { db.close(); }
});
