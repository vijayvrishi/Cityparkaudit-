import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, User } from "@/src/api";
import { useAuth } from "@/src/auth";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(isAdmin);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setUsers(await api<User[]>("/users"));
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const approve = async (u: User) => {
    try {
      await api(`/users/${u.id}/approve`, { method: "POST" });
      showToast(`${u.name} approved`);
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const remove = async (u: User) => {
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      showToast(`${u.name} removed`);
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const pending = users.filter((u) => !u.approved);
  const approved = users.filter((u) => u.approved);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
        <Pressable testID="profile-back-button" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <FlatList
        data={isAdmin ? [...pending, ...approved] : []}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xl }}
        ListHeaderComponent={
          <>
            {/* Current user card */}
            <View style={styles.meCard} testID="profile-user-card">
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.meName}>{user?.name}</Text>
                <Text style={styles.meEmail}>{user?.email}</Text>
              </View>
              <View style={[styles.rolePill, isAdmin && { backgroundColor: C.goldDeep }]}>
                <Text style={[styles.roleText, isAdmin && { color: C.goldSoft }]}>
                  {isAdmin ? "Admin" : "Auditor"}
                </Text>
              </View>
            </View>

            <Pressable testID="logout-button" style={styles.logoutBtn} onPress={logout}>
              <Ionicons name="log-out-outline" size={18} color={C.error} />
              <Text style={styles.logoutText}>Sign Out</Text>
            </Pressable>

            {isAdmin && (
              <>
                <Text style={styles.sectionTitle}>
                  Team Members {pending.length > 0 ? `· ${pending.length} pending` : ""}
                </Text>
                {loading && <ActivityIndicator color={C.gold} style={{ marginTop: SP.lg }} />}
                {!loading && users.length === 0 && (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyText}>No users yet</Text>
                  </View>
                )}
              </>
            )}
          </>
        }
        renderItem={({ item }) => (
          <View style={[styles.userCard, !item.approved && { borderColor: C.goldDeep }]} testID={`user-card-${item.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{item.name}</Text>
              <Text style={styles.userEmail}>{item.email}</Text>
            </View>
            {!item.approved ? (
              <>
                <View style={[styles.statusPill, { backgroundColor: C.warnBg }]}>
                  <Text style={[styles.statusText, { color: C.warn }]}>Pending</Text>
                </View>
                <Pressable testID={`approve-user-${item.id}`} style={styles.approveBtn} onPress={() => approve(item)}>
                  <Ionicons name="checkmark" size={16} color={C.onGold} />
                  <Text style={styles.approveText}>Approve</Text>
                </Pressable>
              </>
            ) : (
              <View style={[styles.statusPill, { backgroundColor: C.successBg }]}>
                <Text style={[styles.statusText, { color: C.success }]}>
                  {item.role === "admin" ? "Admin" : "Approved"}
                </Text>
              </View>
            )}
            {item.id !== user?.id && (
              <Pressable testID={`delete-user-${item.id}`} style={styles.deleteBtn} onPress={() => remove(item)}>
                <Ionicons name="trash-outline" size={17} color={C.text3} />
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: SP.sm, backgroundColor: "#181818",
    borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: SP.lg, paddingBottom: SP.md,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -SP.sm },
  headerTitle: { color: C.text, fontSize: 24, fontFamily: F.display },
  meCard: {
    backgroundColor: C.surface, borderRadius: R.lg, padding: SP.lg, flexDirection: "row",
    alignItems: "center", gap: SP.md, borderWidth: 1, borderColor: C.border,
  },
  avatar: { width: 52, height: 52, borderRadius: R.pill, backgroundColor: C.goldDeep, alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.goldSoft, fontSize: 24, fontFamily: F.display },
  meName: { color: C.text, fontSize: 19, fontFamily: F.display },
  meEmail: { color: C.text3, fontSize: 13, marginTop: 1 },
  rolePill: { backgroundColor: C.surface2, borderRadius: R.pill, paddingHorizontal: SP.md, paddingVertical: 5 },
  roleText: { color: C.text2, fontSize: 12 },
  logoutBtn: {
    marginTop: SP.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.sm,
    minHeight: 48, borderRadius: R.md, borderWidth: 1, borderColor: C.errorBg,
  },
  logoutText: { color: C.error, fontSize: 14 },
  sectionTitle: { color: C.text, fontSize: 22, fontFamily: F.display, marginTop: SP.xl, marginBottom: SP.md },
  emptyBox: { backgroundColor: C.surface, borderRadius: R.md, padding: SP.xl, alignItems: "center", borderWidth: 1, borderColor: C.border },
  emptyText: { color: C.text3, fontSize: 13 },
  userCard: {
    backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, marginBottom: SP.sm,
    flexDirection: "row", alignItems: "center", gap: SP.sm, borderWidth: 1, borderColor: C.border,
  },
  userName: { color: C.text, fontSize: 15 },
  userEmail: { color: C.text3, fontSize: 12, marginTop: 1 },
  statusPill: { borderRadius: R.pill, paddingHorizontal: SP.md, paddingVertical: 4 },
  statusText: { fontSize: 11 },
  approveBtn: {
    flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.gold,
    borderRadius: R.md, paddingHorizontal: SP.md, height: 34,
  },
  approveText: { color: C.onGold, fontSize: 12, fontWeight: "500" },
  deleteBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
