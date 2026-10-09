/** Keep the provisioning operation alive after an early retryable response.
 * The caller registers the SAME promise with Next after(), never starts it twice. */
export async function waitForProvisioning<T>(
  pending: Promise<T>,
  retain: (work: Promise<void>) => void,
  timeoutMs = 500,
): Promise<T | null> {
  retain(pending.then(() => undefined, () => undefined));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
