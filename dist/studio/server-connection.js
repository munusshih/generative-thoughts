export const SERVER_UNAVAILABLE_CODE = "LOCAL_SERVER_UNAVAILABLE";

export function createServerUnavailableError(cause) {
  const error = new Error(
    "Local server disconnected. Reopen start.command; reconnecting automatically.",
    { cause },
  );
  error.code = SERVER_UNAVAILABLE_CODE;
  return error;
}

export function isServerUnavailable(error) {
  return error?.code === SERVER_UNAVAILABLE_CODE;
}

export function createServerConnection({
  probe,
  onDisconnected,
  onReconnected,
  onRecoveryError,
  retryMs = 1200,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}) {
  let disconnected = false;
  let checking = false;
  let timer = null;
  let stopped = false;

  function scheduleProbe() {
    if (stopped || timer !== null) return;
    timer = setTimeoutFn(probeUntilReady, retryMs);
  }

  async function probeUntilReady() {
    timer = null;
    if (stopped || checking) return;
    checking = true;

    try {
      await probe();
      await onReconnected?.();
      disconnected = false;
    } catch (error) {
      onRecoveryError?.(error);
      scheduleProbe();
    } finally {
      checking = false;
    }
  }

  function report(error) {
    if (!isServerUnavailable(error)) return false;

    if (!disconnected) {
      disconnected = true;
      onDisconnected?.(error);
    }

    scheduleProbe();
    return true;
  }

  function stop() {
    stopped = true;
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  }

  return {
    get disconnected() {
      return disconnected;
    },
    report,
    stop,
  };
}
