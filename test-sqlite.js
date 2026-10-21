const { DatabaseSync } = require("node:sqlite")

module.exports = function createTestDatabase(path = ":memory:") {
  const raw = new DatabaseSync(path)
  raw.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
  return {
    raw, queries: [], failWrite: false, failAtStep: -1,
    async execute(sql, args) {
      if (this.failWrite) throw new Error("Simulated database write failure")
      if (args) raw.prepare(sql).run(...args)
      else raw.exec(sql)
    },
    async fetchAll(sql, args = []) {
      this.queries.push(sql)
      return raw.prepare(sql).all(...args)
    },
    async transaction(steps, options = {}) {
      if (this.failWrite) throw new Error("Simulated database write failure")
      raw.exec(options.kind === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN")
      try {
        for (const [index, step] of steps.entries()) {
          if (index === this.failAtStep) throw new Error("Simulated interrupted transaction")
          raw.prepare(step.sql).run(...(step.args || []))
        }
        raw.exec("COMMIT")
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
    },
    close() { raw.close() },
  }
}
