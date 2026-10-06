// Mute changes, navigation, settings, and removal must finish in order per tab.
const tabTaskQueues = new Map<number, Promise<unknown>>();

export function queueTabTask<T>(
  tabId: number,
  task: () => Promise<T>
): Promise<T> {
  const previousTask = tabTaskQueues.get(tabId) || Promise.resolve();
  const nextTask = previousTask
    .catch(() => {})
    .then(task);

  tabTaskQueues.set(tabId, nextTask);
  const cleanUpQueue = () => {
    if (tabTaskQueues.get(tabId) === nextTask) {
      tabTaskQueues.delete(tabId);
    }
  };
  nextTask.then(cleanUpQueue, cleanUpQueue);

  return nextTask;
}
