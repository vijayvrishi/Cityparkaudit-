import { api } from "./api";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export type PushUnsupportedReason = "insecure" | "ios-not-installed" | "unsupported" | null;

// When isPushSupported() is false, this tells the UI *why* so it can point the
// user at the fix instead of just hiding the feature (the two real causes we've
// hit in production: the old plain-HTTP bookmark, and iOS Safari requiring
// "Add to Home Screen" before it allows Web Push at all).
export function getPushUnsupportedReason(): PushUnsupportedReason {
  if (typeof window === "undefined") return null;
  if (isPushSupported()) return null;

  const isSecure = window.location.protocol === "https:" || window.location.hostname === "localhost";
  if (!isSecure) return "insecure";

  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && typeof document !== "undefined" && "ontouchend" in document);
  const isStandalone =
    (window.navigator as any).standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  if (isIOS && !isStandalone) return "ios-not-installed";

  return "unsupported";
}

export function getNotificationPermission(): NotificationPermission | null {
  if (typeof Notification === "undefined") return null;
  return Notification.permission;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export async function enablePushNotifications(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const { key } = await api<{ key: string }>("/notifications/vapid-public-key");
  if (!key) return false;

  // navigator.serviceWorker.ready never rejects on its own - if registration
  // failed (bad MIME type, 404, scope mismatch) it just hangs forever, which
  // looks to the user like the toggle silently doing nothing. Time it out so
  // togglePush() can surface a real error instead.
  const reg = await withTimeout(
    navigator.serviceWorker.ready,
    8000,
    "Service worker did not become ready - try reloading the page",
  );
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }
  const json = sub.toJSON();
  await api("/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    }),
  });
  return true;
}

export async function disablePushNotifications(): Promise<void> {
  const sub = await getExistingSubscription();
  if (sub) {
    try {
      await api("/notifications/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } finally {
      await sub.unsubscribe();
    }
  }
}
