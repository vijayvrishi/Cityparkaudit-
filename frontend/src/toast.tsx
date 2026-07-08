import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C, R, SP } from "./theme";

type ToastType = "success" | "error";
let listener: ((msg: string, type: ToastType) => void) | null = null;

export function showToast(msg: string, type: ToastType = "success") {
  listener?.(msg, type);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (msg, type) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ msg, type });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
      }, 2600);
    };
    return () => { listener = null; };
  }, [opacity]);

  if (!toast) return null;
  const isErr = toast.type === "error";
  return (
    <Animated.View
      testID="toast-message"
      pointerEvents="none"
      style={[styles.toast, { top: insets.top + SP.md, opacity, borderColor: isErr ? C.error : C.gold }]}
    >
      <Ionicons name={isErr ? "alert-circle" : "checkmark-circle"} size={18} color={isErr ? C.error : C.gold} />
      <Text style={styles.text} numberOfLines={2}>{toast.msg}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute", left: SP.lg, right: SP.lg, zIndex: 9999,
    backgroundColor: C.surface2, borderWidth: 1, borderRadius: R.md,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
    flexDirection: "row", alignItems: "center", gap: SP.sm,
  },
  text: { color: C.text, fontSize: 14, flex: 1 },
});
