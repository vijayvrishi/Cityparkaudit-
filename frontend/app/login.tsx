import React, { useState } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "@/src/auth";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

const HERO_IMG = "https://images.pexels.com/photos/18415806/pexels-photo-18415806.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      showToast("Email and password are required", "error");
      return;
    }
    if (mode === "register" && !name.trim()) {
      showToast("Name is required", "error");
      return;
    }
    if (mode === "register" && !email.trim().toLowerCase().endsWith("@cityparkhotel.in")) {
      showToast("Use your @cityparkhotel.in staff email", "error");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        const res = await register(name.trim(), email.trim(), password);
        showToast(res.message);
        setMode("login");
        setPassword("");
      }
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image source={{ uri: HERO_IMG }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient colors={["rgba(18,18,18,0.55)", "rgba(18,18,18,0.97)"]} style={StyleSheet.absoluteFill} />
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: SP.xl, paddingTop: insets.top + SP.xl, paddingBottom: insets.bottom + SP.xl }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>CITY PARK HOTEL</Text>
        <Text style={styles.title}>CityPark Audit</Text>
        <Text style={styles.subtitle}>
          {mode === "login" ? "Sign in to continue" : "Create your auditor account"}
        </Text>

        <View style={styles.card}>
          {mode === "register" && (
            <TextInput
              testID="register-name-input"
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor={C.text3}
              value={name}
              onChangeText={setName}
            />
          )}
          <TextInput
            testID="login-email-input"
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={C.text3}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <View style={styles.passwordRow}>
            <TextInput
              testID="login-password-input"
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Password"
              placeholderTextColor={C.text3}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <Pressable testID="toggle-password-visibility" style={styles.eyeBtn} onPress={() => setShowPassword((s) => !s)}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={C.text3} />
            </Pressable>
          </View>

          <Pressable testID="login-submit-button" style={[styles.cta, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={C.onGold} />
            ) : (
              <Text style={styles.ctaText}>{mode === "login" ? "Sign In" : "Request Access"}</Text>
            )}
          </Pressable>

          {mode === "register" && (
            <View style={styles.noticeBox}>
              <Ionicons name="shield-checkmark-outline" size={16} color={C.goldSoft} />
              <Text style={styles.noticeText}>New accounts require admin approval before signing in.</Text>
            </View>
          )}
        </View>

        <Pressable
          testID="toggle-auth-mode-button"
          style={styles.switchBtn}
          onPress={() => setMode((m) => (m === "login" ? "register" : "login"))}
        >
          <Text style={styles.switchText}>
            {mode === "login" ? "New here? " : "Already approved? "}
            <Text style={{ color: C.gold }}>{mode === "login" ? "Request access" : "Sign in"}</Text>
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  kicker: { color: C.goldSoft, fontSize: 11, letterSpacing: 4, textAlign: "center" },
  title: { color: C.text, fontSize: 40, fontFamily: F.display, textAlign: "center", marginTop: SP.xs },
  subtitle: { color: C.text2, fontSize: 14, textAlign: "center", marginTop: SP.xs, marginBottom: SP.xl },
  card: {
    backgroundColor: "rgba(30,30,30,0.92)", borderRadius: R.lg, padding: SP.xl,
    borderWidth: 1, borderColor: C.border, gap: SP.md,
  },
  input: {
    backgroundColor: C.surface2, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    color: C.text, paddingHorizontal: SP.lg, minHeight: 50, fontSize: 15,
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  eyeBtn: {
    width: 50, height: 50, borderRadius: R.md, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  cta: { backgroundColor: C.gold, borderRadius: R.md, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: SP.xs },
  ctaText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
  noticeBox: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  noticeText: { color: C.text3, fontSize: 12, flex: 1 },
  switchBtn: { alignSelf: "center", marginTop: SP.xl, minHeight: 44, justifyContent: "center" },
  switchText: { color: C.text2, fontSize: 14 },
});
