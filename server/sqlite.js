'use strict';
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch {}
if (!DatabaseSync) module.exports = require('better-sqlite3');
else module.exports = class Database {
  constructor(file, options = {}) { this.native = new DatabaseSync(file, { readOnly: !!options.readonly }); this.depth = 0; this.native.exec('PRAGMA busy_timeout=5000'); }
  exec(sql) { this.native.exec(sql); return this; }
  prepare(sql) {
    const statement = this.native.prepare(sql), normalize = row => row && { ...row };
    return { run: (...args) => ({ ...statement.run(...args) }), get: (...args) => normalize(statement.get(...args)), all: (...args) => statement.all(...args).map(normalize) };
  }
  pragma(sql) { return this.native.prepare(`PRAGMA ${sql}`).all().map(row => ({ ...row })); }
  transaction(fn) {
    return (...args) => {
      const name = `gitpm_${this.depth++}`;
      this.exec(`SAVEPOINT ${name}`);
      try { const result = fn(...args); this.exec(`RELEASE ${name}`); return result; }
      catch (error) { this.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
      finally { this.depth--; }
    };
  }
  close() { this.native.close(); }
};
