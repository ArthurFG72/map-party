export function createRequestController() {
  let current = null;
  return {
    begin() {
      current?.abort();
      current = new AbortController();
      return current;
    },
    cancel() {
      if (!current) return false;
      current?.abort();
      current = null;
      return true;
    },
    finish(controller) {
      if (current !== controller) return false;
      current = null;
      return true;
    },
    isCurrent(controller) {
      return current === controller;
    }
  };
}
