export function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

export function showPushNotification(
  title: string,
  body: string,
  icon?: string,
): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    new Notification(title, { body, icon, silent: false });
  } catch {
    // Ignore (e.g., in sandboxed iframes)
  }
}
