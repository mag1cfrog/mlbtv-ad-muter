import { setImmediate } from "node:timers/promises";

export async function flush(): Promise<void> {
  await setImmediate();
}

// Advance browser timers without waiting for real time, draining messages between callbacks.
export function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void; interval?: number }>();

  function schedule(callback: () => void, delay = 0, interval?: number): number {
    const id = nextId++;
    timers.set(id, { at: now + delay, callback, interval });
    return id;
  }

  const browserTimers = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout(callback: () => void, delay = 0) {
      return schedule(callback, delay);
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    setInterval(callback: () => void, delay: number) {
      return schedule(callback, delay, delay);
    },
    clearInterval(id: number) {
      timers.delete(id);
    }
  };

  async function advance(milliseconds: number): Promise<void> {
    const target = now + milliseconds;
    while (timers.size) {
      const [id, timer] = [...timers.entries()].sort(
        (a, b) => a[1].at - b[1].at || a[0] - b[0]
      )[0];
      if (timer.at > target) {
        break;
      }
      now = timer.at;
      if (timer.interval) {
        timer.at += timer.interval;
      } else {
        timers.delete(id);
      }
      timer.callback();
      await flush();
    }
    now = target;
    await flush();
  }

  return { browserTimers, advance, pendingCount: () => timers.size };
}
