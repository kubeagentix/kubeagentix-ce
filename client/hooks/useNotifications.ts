import { useState, useCallback } from "react";

export interface Notification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const add = useCallback(
    (type: Notification["type"], message: string, duration: number = 4000) => {
      const id = `notif-${Date.now()}-${Math.random()}`;
      const notification: Notification = { id, type, message, duration };

      setNotifications((prev) => [...prev, notification]);

      if (duration > 0) {
        setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, duration);
      }

      return id;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return {
    notifications,
    addSuccess: (msg: string, duration?: number) =>
      add("success", msg, duration),
    addError: (msg: string, duration?: number) => add("error", msg, duration),
    addWarning: (msg: string, duration?: number) =>
      add("warning", msg, duration),
    addInfo: (msg: string, duration?: number) => add("info", msg, duration),
    remove,
  };
}
