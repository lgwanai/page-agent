const INSTANCE_STORAGE_KEY = 'pageAgentInstanceIdV1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let instancePromise: Promise<string> | undefined;

/** Per extension installation/profile; stable across browser and worker restarts. */
export function getInstanceId(): Promise<string> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const stored = await chrome.storage.local.get(INSTANCE_STORAGE_KEY);
      const value: unknown = stored[INSTANCE_STORAGE_KEY];
      if (typeof value === 'string' && UUID.test(value)) return value;
      const instanceId = crypto.randomUUID();
      await chrome.storage.local.set({ [INSTANCE_STORAGE_KEY]: instanceId });
      return instanceId;
    })().catch((error) => { instancePromise = undefined; throw error; });
  }
  return instancePromise;
}
