import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { api, ActionItem, TeamMember } from "@/src/api";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
];
const DEPARTMENTS = ["General", "Front Office", "Housekeeping", "Food & Beverage", "Maintenance", "Wellness"];

function formatReportedAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: C.error, bg: C.errorBg },
  in_progress: { label: "In Progress", color: C.warn, bg: C.warnBg },
  resolved: { label: "Resolved", color: C.success, bg: C.successBg },
};

export default function ActionsScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<ActionItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", department: "General", priority: "medium", assignee: "", due_date: null as string | null });
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [permBlocked, setPermBlocked] = useState(false);

  const dueOptions = (() => {
    const d = (days: number) => {
      const dt = new Date();
      dt.setDate(dt.getDate() + days);
      return dt.toISOString().slice(0, 10);
    };
    return [
      { label: "No due date", value: null as string | null },
      { label: "Today", value: d(0) },
      { label: "Tomorrow", value: d(1) },
      { label: "In 3 days", value: d(3) },
      { label: "Next week", value: d(7) },
    ];
  })();

  const load = useCallback(async () => {
    try {
      const [its, tm] = await Promise.all([
        api<ActionItem[]>("/action-items"),
        api<TeamMember[]>("/team"),
      ]);
      setItems(its);
      setTeam(tm);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  const setStatus = async (item: ActionItem, status: string) => {
    if (status === "resolved" && !item.resolution_photo_base64) {
      await resolveWithPhoto(item);
      return;
    }
    try {
      await api(`/action-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelected(null);
      showToast(`Marked as ${STATUS_META[status].label}`);
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const resolveWithPhoto = async (item: ActionItem) => {
    setResolving(true);
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) { setPermBlocked(true); return; }
        perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          if (!perm.canAskAgain) setPermBlocked(true);
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const targetWidth = Math.min(asset.width || 1024, 1024);
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: targetWidth } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) {
        showToast("Could not capture photo", "error");
        return;
      }
      await api(`/action-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved", resolution_photo_base64: manipulated.base64 }),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelected(null);
      showToast("Marked as Resolved");
      load();
    } catch (e: any) {
      showToast(e.message || "Could not capture photo", "error");
    } finally {
      setResolving(false);
    }
  };

  const reassign = async (item: ActionItem, name: string) => {
    try {
      const updated = await api<ActionItem>(`/action-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignee: name }),
      });
      Haptics.selectionAsync();
      setSelected(updated);
      showToast(name ? `Assigned to ${name}` : "Unassigned");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const addItem = async () => {
    if (!form.title.trim()) {
      showToast("Title is required", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/action-items", {
        method: "POST",
        body: JSON.stringify({ ...form, assignee: form.assignee.trim() || null }),
      });
      setShowAdd(false);
      setForm({ title: "", description: "", department: "General", priority: "medium", assignee: "", due_date: null });
      showToast("Action item created");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Action Items</Text>
          <Pressable testID="add-action-button" style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={22} color={C.onGold} />
          </Pressable>
        </View>
        <View style={styles.chipRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                testID={`action-filter-${f.key}`}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, filter === f.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.gold} size="large" /></View>
      ) : (
        <FlatList
          testID="actions-list"
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: SP.xl }}
          ListEmptyComponent={
            <View style={styles.emptyBox} testID="actions-empty">
              <Ionicons name="shield-checkmark-outline" size={28} color={C.text3} />
              <Text style={styles.emptyText}>No action items here</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            const overdue = !!item.due_date && item.status !== "resolved" && item.due_date < new Date().toISOString().slice(0, 10);
            return (
              <Pressable testID={`action-card-${item.id}`} style={styles.card} onPress={() => setSelected(item)}>
                <View style={styles.cardRow}>
                  <View style={[styles.priorityDot, { backgroundColor: item.priority === "high" ? C.error : item.priority === "medium" ? C.warn : C.text3 }]} />
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                </View>
                {!!item.description && <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>}
                <View style={styles.metaRow}>
                  <View style={styles.metaChip} testID={`action-reported-${item.id}`}>
                    <Ionicons name="time-outline" size={12} color={C.text3} />
                    <Text style={styles.metaChipText}>Reported {formatReportedAt(item.created_at)}</Text>
                  </View>
                  {!!item.assignee && (
                    <View style={styles.metaChip} testID={`action-assignee-${item.id}`}>
                      <Ionicons name="person-outline" size={12} color={C.text3} />
                      <Text style={styles.metaChipText}>{item.assignee}</Text>
                    </View>
                  )}
                  {!!item.due_date && (
                    <View style={styles.metaChip} testID={`action-due-${item.id}`}>
                      <Ionicons name="calendar-outline" size={12} color={overdue ? C.error : C.text3} />
                      <Text style={[styles.metaChipText, overdue && { color: C.error }]}>
                        {overdue ? "Overdue · " : ""}{new Date(item.due_date + "T00:00:00").toLocaleDateString()}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardMeta}>{item.department}{item.location ? ` · ${item.location}` : ""}</Text>
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Status change sheet */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setSelected(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={2}>{selected?.title}</Text>
            {!!selected?.resolution_photo_base64 && (
              <Image
                source={{ uri: `data:image/jpeg;base64,${selected.resolution_photo_base64}` }}
                style={styles.resolutionPhoto}
                contentFit="cover"
                testID="resolution-photo"
              />
            )}
            <Text style={styles.sheetSub}>Update status</Text>
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <Pressable
                key={key}
                testID={`set-status-${key}`}
                style={[styles.statusOption, selected?.status === key && { borderColor: C.gold }]}
                onPress={() => selected && setStatus(selected, key)}
                disabled={resolving}
              >
                <View style={[styles.priorityDot, { backgroundColor: meta.color }]} />
                <Text style={styles.statusOptionText}>
                  {key === "resolved" && !selected?.resolution_photo_base64 ? "Resolved (photo required)" : meta.label}
                </Text>
                {resolving && key === "resolved" ? (
                  <ActivityIndicator color={C.gold} size="small" />
                ) : selected?.status === key ? (
                  <Ionicons name="checkmark" size={18} color={C.gold} />
                ) : key === "resolved" ? (
                  <Ionicons name="camera-outline" size={16} color={C.text3} />
                ) : null}
              </Pressable>
            ))}
            <Text style={styles.sheetSub}>Assign to</Text>
            <View style={styles.assigneeWrap}>
              <Pressable
                testID="reassign-unassigned"
                style={[styles.assigneeChip, !selected?.assignee && styles.assigneeChipActive]}
                onPress={() => selected && reassign(selected, "")}
              >
                <Text style={[styles.assigneeChipText, !selected?.assignee && { color: C.onGold }]}>Unassigned</Text>
              </Pressable>
              {team.map((m) => {
                const active = selected?.assignee === m.name;
                return (
                  <Pressable
                    key={m.id}
                    testID={`reassign-${m.id}`}
                    style={[styles.assigneeChip, active && styles.assigneeChipActive]}
                    onPress={() => selected && reassign(selected, m.name)}
                  >
                    <Ionicons name="person-outline" size={12} color={active ? C.onGold : C.text3} />
                    <Text style={[styles.assigneeChipText, active && { color: C.onGold }]}>{m.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* Camera-permission-blocked sheet */}
      <Modal visible={permBlocked} transparent animationType="slide" onRequestClose={() => setPermBlocked(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPermBlocked(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Camera Access Needed</Text>
            <Text style={styles.sheetSub}>Camera access is blocked. Enable it in Settings to take a resolution photo.</Text>
            <Pressable testID="open-settings-button" style={styles.statusOption} onPress={() => Linking.openSettings()}>
              <Ionicons name="settings-outline" size={20} color={C.gold} />
              <Text style={styles.statusOptionText}>Open Settings</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Add item sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAdd(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>New Action Item</Text>
            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: SP.md }}>
            <TextInput
              testID="action-title-input"
              style={styles.input}
              placeholder="Title *"
              placeholderTextColor={C.text3}
              value={form.title}
              onChangeText={(t) => setForm((f) => ({ ...f, title: t }))}
            />
            <TextInput
              testID="action-desc-input"
              style={[styles.input, { minHeight: 70, paddingTop: SP.md }]}
              placeholder="Description"
              placeholderTextColor={C.text3}
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              multiline
            />
            <Text style={styles.sheetSub}>Concerned department</Text>
            <View style={styles.assigneeWrap}>
              {DEPARTMENTS.map((d) => {
                const active = form.department === d;
                return (
                  <Pressable
                    key={d}
                    testID={`dept-option-${d.toLowerCase().replace(/\s+/g, "-")}`}
                    style={[styles.assigneeChip, active && styles.assigneeChipActive]}
                    onPress={() => setForm((f) => ({ ...f, department: d }))}
                  >
                    <Text style={[styles.assigneeChipText, active && { color: C.onGold }]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.sheetSub}>Assign to</Text>
            <View style={styles.assigneeWrap}>
              <Pressable
                testID="assignee-option-unassigned"
                style={[styles.assigneeChip, !form.assignee && styles.assigneeChipActive]}
                onPress={() => setForm((f) => ({ ...f, assignee: "" }))}
              >
                <Text style={[styles.assigneeChipText, !form.assignee && { color: C.onGold }]}>Unassigned</Text>
              </Pressable>
              {team.map((m) => {
                const active = form.assignee === m.name;
                return (
                  <Pressable
                    key={m.id}
                    testID={`assignee-option-${m.id}`}
                    style={[styles.assigneeChip, active && styles.assigneeChipActive]}
                    onPress={() => setForm((f) => ({ ...f, assignee: active ? "" : m.name }))}
                  >
                    <Ionicons name="person-outline" size={12} color={active ? C.onGold : C.text3} />
                    <Text style={[styles.assigneeChipText, active && { color: C.onGold }]}>{m.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
              {dueOptions.map((o) => (
                <Pressable
                  key={o.label}
                  testID={`due-option-${o.label.toLowerCase().replace(/\s+/g, "-")}`}
                  style={[styles.dueChip, form.due_date === o.value && styles.dueChipActive]}
                  onPress={() => setForm((f) => ({ ...f, due_date: o.value }))}
                >
                  <Text style={[styles.dueChipText, form.due_date === o.value && { color: C.onGold }]}>{o.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.priorityRow}>
              {(["low", "medium", "high"] as const).map((p) => (
                <Pressable
                  key={p}
                  testID={`priority-${p}`}
                  style={[styles.prioBtn, form.priority === p && styles.prioBtnActive]}
                  onPress={() => setForm((f) => ({ ...f, priority: p }))}
                >
                  <Text style={[styles.prioText, form.priority === p && { color: C.onGold }]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            </ScrollView>
            <Pressable testID="save-action-button" style={[styles.cta, saving && { opacity: 0.6 }]} onPress={addItem} disabled={saving}>
              {saving ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.ctaText}>Create</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { backgroundColor: "#181818", borderBottomWidth: 1, borderBottomColor: C.border },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SP.lg },
  headerTitle: { color: C.text, fontSize: 28, fontFamily: F.display },
  addBtn: { width: 40, height: 40, borderRadius: R.pill, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRow: { gap: SP.sm, paddingHorizontal: SP.lg, alignItems: "center" },
  chip: {
    height: 36, paddingHorizontal: SP.lg, borderRadius: R.pill, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  chipActive: { backgroundColor: C.gold, borderColor: C.gold },
  chipText: { color: C.text2, fontSize: 13 },
  chipTextActive: { color: C.onGold },
  emptyBox: { alignItems: "center", gap: SP.md, paddingTop: SP.xxl * 2 },
  emptyText: { color: C.text3, fontSize: 13 },
  card: {
    backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, marginBottom: SP.md,
    borderWidth: 1, borderColor: C.border, gap: SP.sm,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: C.text, fontSize: 15, flex: 1 },
  cardDesc: { color: C.text3, fontSize: 13 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  metaChip: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.surface2,
    borderRadius: R.pill, paddingHorizontal: SP.sm, paddingVertical: 3,
  },
  metaChipText: { color: C.text3, fontSize: 11 },
  dueChip: {
    height: 36, paddingHorizontal: SP.md, borderRadius: R.pill, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  dueChipActive: { backgroundColor: C.gold, borderColor: C.gold },
  dueChipText: { color: C.text2, fontSize: 12 },
  assigneeWrap: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  assigneeChip: {
    flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: SP.md,
    borderRadius: R.pill, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    justifyContent: "center",
  },
  assigneeChipActive: { backgroundColor: C.gold, borderColor: C.gold },
  assigneeChipText: { color: C.text2, fontSize: 12 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardMeta: { color: C.text3, fontSize: 12 },
  statusPill: { paddingHorizontal: SP.md, paddingVertical: 4, borderRadius: R.pill },
  statusText: { fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: SP.xl, gap: SP.md,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: R.pill, backgroundColor: C.borderStrong },
  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.display },
  sheetSub: { color: C.text3, fontSize: 13 },
  statusOption: {
    flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface2,
    borderRadius: R.md, paddingHorizontal: SP.lg, minHeight: 48, borderWidth: 1, borderColor: C.border,
  },
  statusOptionText: { color: C.text, fontSize: 14, flex: 1 },
  resolutionPhoto: { width: "100%", height: 160, borderRadius: R.md, marginBottom: SP.xs },
  input: {
    backgroundColor: C.surface2, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    color: C.text, paddingHorizontal: SP.lg, minHeight: 48, fontSize: 15,
  },
  priorityRow: { flexDirection: "row", gap: SP.sm },
  prioBtn: {
    flex: 1, height: 40, borderRadius: R.md, backgroundColor: C.surface2, borderWidth: 1,
    borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  prioBtnActive: { backgroundColor: C.gold, borderColor: C.gold },
  prioText: { color: C.text2, fontSize: 13 },
  cta: { backgroundColor: C.gold, borderRadius: R.md, minHeight: 50, alignItems: "center", justifyContent: "center" },
  ctaText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
});
