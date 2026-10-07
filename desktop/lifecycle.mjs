// Own the entire startup promise so an early close cannot orphan a service.
export function ownStartup(start) {
  let stopping = false;
  let shutdown;
  const ready = Promise.resolve().then(start);
  return {
    ready,
    get stopping() { return stopping; },
    stop() {
      stopping = true;
      return shutdown ??= ready.then(instance => instance.close(), () => {});
    },
  };
}
