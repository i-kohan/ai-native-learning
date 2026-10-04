export const LOCAL_INSPECTION_SIGNAL = "HARNESS_EPISODE_EXTENSION";
export const LOCAL_INSPECTION_SIGNAL_VALUE = "local-inspection";

export async function withLocalInspectionSignal<T>(
  enabled: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env[LOCAL_INSPECTION_SIGNAL];
  if (enabled) {
    process.env[LOCAL_INSPECTION_SIGNAL] = LOCAL_INSPECTION_SIGNAL_VALUE;
  } else {
    delete process.env[LOCAL_INSPECTION_SIGNAL];
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[LOCAL_INSPECTION_SIGNAL];
    } else {
      process.env[LOCAL_INSPECTION_SIGNAL] = previous;
    }
  }
}
