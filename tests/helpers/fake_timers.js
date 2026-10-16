// Minimal deterministic timers for unit tests.
function createFakeTimers(start = 0) {
  let now = start;
  let nextId = 1;
  const pending = new Map(); // id -> { at, fn, interval }

  function schedule(fn, delay, interval) {
    const id = nextId++;
    pending.set(id, { at: now + Math.max(0, delay), fn, interval: interval ? Math.max(1, delay) : 0 });
    return id;
  }

  return {
    now: () => now,
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    get pendingCount() { return pending.size; },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextIdDue = null;
        let nextAt = Infinity;
        for (const [id, t] of pending) {
          if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextIdDue = id; }
        }
        if (nextIdDue === null) break;
        const timer = pending.get(nextIdDue);
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else pending.delete(nextIdDue);
        timer.fn();
      }
      now = target;
    }
  };
}

module.exports = { createFakeTimers };
