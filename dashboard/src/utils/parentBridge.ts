// parentBridge.ts — postMessage bridge for RC iframe token retrieval

type ParentMessageType =
  | "LOCAL_STORAGE_REQUEST"
  | "LOCAL_STORAGE_RESPONSE"
  | "LOCAL_STORAGE_SET"
  | "LOCAL_STORAGE_REMOVE";

interface ParentMessage {
  type: ParentMessageType;
  key?: string;
  value?: string;
  requestId?: string;
}

function generateRequestId(): string {
  return Math.random().toString(36).slice(2);
}

function isLocalStorageAccessible(): boolean {
  try {
    const testKey = "__storage_test__";
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

async function requestLocalStorage(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener("message", handleResponse);
        resolve(null);
      }
    }, 2000);

    function handleResponse(event: MessageEvent) {
      const data = event.data as ParentMessage;
      if (
        data?.type === "LOCAL_STORAGE_RESPONSE" &&
        data.requestId === requestId
      ) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          window.removeEventListener("message", handleResponse);
          resolve(data.value ?? null);
        }
      }
    }

    window.addEventListener("message", handleResponse);

    const msg: ParentMessage = {
      type: "LOCAL_STORAGE_REQUEST",
      key,
      requestId,
    };

    window.parent.postMessage(msg, "*");
  });
}

const parentBridge = {
  async get(key: string): Promise<string | null> {
    if (isLocalStorageAccessible()) {
      return localStorage.getItem(key);
    }
    return await requestLocalStorage(key);
  },

  set(key: string, value: string): void {
    if (isLocalStorageAccessible()) {
      localStorage.setItem(key, value);
      return;
    }
    window.parent.postMessage({ type: "LOCAL_STORAGE_SET", key, value }, "*");
  },

  remove(key: string): void {
    if (isLocalStorageAccessible()) {
      localStorage.removeItem(key);
      return;
    }
    window.parent.postMessage({ type: "LOCAL_STORAGE_REMOVE", key }, "*");
  },
};

export default parentBridge;
