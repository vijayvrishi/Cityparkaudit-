import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { api, Locations, Schedule, Template } from "@/src/api";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

const REC_LABEL: Record<string, string> = { once: "One-time", daily: "Daily", weekly: "Weekly" };

export default function SchedulesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [locations, setLocations] = useState<Locations | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  // form state
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<"once" | "daily" | "weekly">("daily");
  const [auditorName, setAuditorName] = useState("");
  const [locTab, setLocTab] = useState<"rooms" | "areas">("rooms");
  const [floorIdx, setFloorIdx] = useState(0);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, t, l] = await Promise.all([
        api<Schedule[]>("/schedules"),
        api<Template[]>("/templates"),
        api<Locations>("/locations"),
      ]);
      setSchedules(s);
      setTemplates(t);
      setLocations(l);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createSchedule = async () => {
    if (!templateId) {
      showToast("Select a template", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/schedules", {
        method: "POST",
        body: JSON.stringify({
          template_id: templateId,
          location: selectedLoc,
          auditor_name: auditorName.trim() || "Auditor",
          recurrence,
        }),
      });
      setShowAdd(false);
      setTemplateId(null);
      setSelectedLoc(null);
      setAuditorName("");
      showToast("Schedule created");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const startNow = async (s: Schedule) => {
    try {
      const res = await api<{ audit: { id: string } }>(`/schedules/${s.id}/start`, { method: "POST" });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(`/audit/${res.audit.id}`);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const toggleActive = async (s: Schedule) => {
    try {
      await api(`/schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ active: !s.active }) });
      showToast(s.active ? "Schedule paused" : "Schedule resumed");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const remove = async (s: Schedule) => {
    try {
      await api(`/schedules/${s.id}`, { method: "DELETE" });
      showToast("Schedule deleted");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const dueMeta = (s: Schedule) => {
    switch (s.due_status) {
      case "overdue": return { text: "Overdue", color: C.error };
      case "due_today": return { text: "Due today", color: C.gold };
      case "paused": return { text: "Paused", color: C.text3 };
      default: return { text: `Due ${new Date(s.next_due + "T00:00:00").toLocaleDateString()}`, color: C.text2 };
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
        <Pressable testID="schedules-back-button" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Scheduled Audits</Text>
        <Pressable testID="add-schedule-button" style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={22} color={C.onGold} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.gold} size="large" /></View>
      ) : (
        <FlatList
          testID="schedules-list"
          data={schedules}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xl }}
          ListEmptyComponent={
            <View style={styles.emptyBox} testID="schedules-empty">
              <Ionicons name="calendar-outline" size={28} color={C.text3} />
              <Text style={styles.emptyText}>No scheduled audits. Tap + to plan recurring checks.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const due = dueMeta(item);
            return (
              <View style={[styles.card, !item.active && { opacity: 0.55 }]} testID={`schedule-card-${item.id}`}>
                <View style={styles.cardTop}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={(item.icon as any) || "clipboard-outline"} size={20} color={C.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.template_name}</Text>
                    <Text style={styles.cardMeta}>
                      {item.department}{item.location ? ` · ${item.location}` : ""} · {item.auditor_name}
                    </Text>
                  </View>
                  <View style={styles.recPill}>
                    <Text style={styles.recText}>{REC_LABEL[item.recurrence]}</Text>
                  </View>
                </View>
                <View style={styles.cardBottom}>
                  <Text style={[styles.dueText, { color: due.color }]} testID={`schedule-due-${item.id}`}>{due.text}</Text>
                  <View style={styles.btnRow}>
                    <Pressable testID={`schedule-delete-${item.id}`} style={styles.iconBtn} onPress={() => remove(item)}>
                      <Ionicons name="trash-outline" size={18} color={C.text3} />
                    </Pressable>
                    <Pressable testID={`schedule-toggle-${item.id}`} style={styles.iconBtn} onPress={() => toggleActive(item)}>
                      <Ionicons name={item.active ? "pause" : "play"} size={18} color={C.text2} />
                    </Pressable>
                    <Pressable testID={`schedule-start-${item.id}`} style={styles.startBtn} onPress={() => startNow(item)}>
                      <Ionicons name="play" size={13} color={C.onGold} />
                      <Text style={styles.startText}>Start</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Create schedule sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAdd(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>New Schedule</Text>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Template</Text>
              <View style={styles.wrapRow}>
                {templates.map((t) => {
                  const active = templateId === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      testID={`schedule-template-${t.id}`}
                      style={[styles.selChip, active && styles.selChipActive]}
                      onPress={() => {
                        setTemplateId(t.id);
                        setLocTab(t.department === "Food & Beverage" ? "areas" : "rooms");
                      }}
                    >
                      <Text style={[styles.selChipText, active && { color: C.onGold }]}>{t.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Repeats</Text>
              <View style={styles.wrapRow}>
                {(["daily", "weekly", "once"] as const).map((r) => (
                  <Pressable
                    key={r}
                    testID={`recurrence-${r}`}
                    style={[styles.selChip, recurrence === r && styles.selChipActive]}
                    onPress={() => setRecurrence(r)}
                  >
                    <Text style={[styles.selChipText, recurrence === r && { color: C.onGold }]}>{REC_LABEL[r]}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Location {selectedLoc ? `— ${selectedLoc}` : "(optional)"}</Text>
              <View style={styles.locSegment}>
                <Pressable testID="schedule-loc-rooms" style={[styles.locSegBtn, locTab === "rooms" && styles.locSegActive]} onPress={() => setLocTab("rooms")}>
                  <Text style={[styles.locSegText, locTab === "rooms" && { color: C.onGold }]}>Rooms</Text>
                </Pressable>
                <Pressable testID="schedule-loc-areas" style={[styles.locSegBtn, locTab === "areas" && styles.locSegActive]} onPress={() => setLocTab("areas")}>
                  <Text style={[styles.locSegText, locTab === "areas" && { color: C.onGold }]}>Kitchens & Outlets</Text>
                </Pressable>
              </View>

              {locTab === "rooms" && locations && (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorRow} style={{ marginTop: SP.sm }}>
                    {locations.floors.map((f, i) => (
                      <Pressable key={f.floor} testID={`schedule-floor-${i}`} style={[styles.floorChip, floorIdx === i && styles.selChipActive]} onPress={() => setFloorIdx(i)}>
                        <Text style={[styles.selChipText, floorIdx === i && { color: C.onGold }]}>{f.floor}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <View style={[styles.wrapRow, { marginTop: SP.sm }]}>
                    {locations.floors[floorIdx]?.rooms.map((r) => {
                      const label = `Room ${r}`;
                      const active = selectedLoc === label;
                      return (
                        <Pressable key={r} testID={`schedule-room-${r}`} style={[styles.roomChip, active && styles.selChipActive]} onPress={() => setSelectedLoc(active ? null : label)}>
                          <Text style={[styles.selChipText, active && { color: C.onGold }]}>{r}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              {locTab === "areas" && locations && (
                <View style={[styles.wrapRow, { marginTop: SP.sm }]}>
                  {locations.areas.map((a) => {
                    const active = selectedLoc === a;
                    return (
                      <Pressable key={a} testID={`schedule-area-${a.toLowerCase().replace(/\s+/g, "-")}`} style={[styles.selChip, active && styles.selChipActive]} onPress={() => setSelectedLoc(active ? null : a)}>
                        <Text style={[styles.selChipText, active && { color: C.onGold }]}>{a}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text style={styles.label}>Auditor</Text>
              <TextInput
                testID="schedule-auditor-input"
                style={styles.input}
                placeholder="Auditor name"
                placeholderTextColor={C.text3}
                value={auditorName}
                onChangeText={setAuditorName}
              />
            </ScrollView>

            <Pressable testID="save-schedule-button" style={[styles.cta, saving && { opacity: 0.6 }]} onPress={createSchedule} disabled={saving}>
              {saving ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.ctaText}>Create Schedule</Text>}
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
  header: {
    flexDirection: "row", alignItems: "center", gap: SP.sm, backgroundColor: "#181818",
    borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: SP.lg, paddingBottom: SP.md,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -SP.sm },
  headerTitle: { color: C.text, fontSize: 24, fontFamily: F.display, flex: 1 },
  addBtn: { width: 40, height: 40, borderRadius: R.pill, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  emptyBox: { alignItems: "center", gap: SP.md, paddingTop: SP.xxl * 2, paddingHorizontal: SP.xl },
  emptyText: { color: C.text3, fontSize: 13, textAlign: "center" },
  card: {
    backgroundColor: C.surface, borderRadius: R.lg, padding: SP.lg, marginBottom: SP.md,
    borderWidth: 1, borderColor: C.border, gap: SP.md,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: SP.md },
  iconWrap: { width: 42, height: 42, borderRadius: R.md, backgroundColor: C.goldDeep, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: C.text, fontSize: 17, fontFamily: F.display },
  cardMeta: { color: C.text3, fontSize: 12, marginTop: 2 },
  recPill: { backgroundColor: C.surface2, borderRadius: R.pill, paddingHorizontal: SP.md, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  recText: { color: C.goldSoft, fontSize: 11 },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dueText: { fontSize: 13 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  iconBtn: { width: 36, height: 36, borderRadius: R.md, backgroundColor: C.surface2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  startBtn: {
    flexDirection: "row", alignItems: "center", gap: SP.xs, backgroundColor: C.gold,
    borderRadius: R.md, paddingHorizontal: SP.lg, height: 36,
  },
  startText: { color: C.onGold, fontSize: 13, fontWeight: "500" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: SP.xl, gap: SP.md,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: R.pill, backgroundColor: C.borderStrong },
  sheetTitle: { color: C.text, fontSize: 24, fontFamily: F.display },
  label: { color: C.text2, fontSize: 13, marginTop: SP.md, marginBottom: SP.sm },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  selChip: {
    paddingHorizontal: SP.md, height: 36, borderRadius: R.sm, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  selChipActive: { backgroundColor: C.gold, borderColor: C.gold },
  selChipText: { color: C.text2, fontSize: 13 },
  roomChip: {
    width: 56, height: 36, borderRadius: R.sm, backgroundColor: C.surface2, borderWidth: 1,
    borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  floorRow: { gap: SP.sm },
  floorChip: {
    height: 32, paddingHorizontal: SP.md, borderRadius: R.pill, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  locSegment: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: R.md, padding: 4, borderWidth: 1, borderColor: C.border },
  locSegBtn: { flex: 1, height: 34, borderRadius: R.sm, alignItems: "center", justifyContent: "center" },
  locSegActive: { backgroundColor: C.gold },
  locSegText: { color: C.text2, fontSize: 12 },
  input: {
    backgroundColor: C.surface2, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    color: C.text, paddingHorizontal: SP.lg, minHeight: 48, fontSize: 15,
  },
  cta: { backgroundColor: C.gold, borderRadius: R.md, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: SP.sm },
  ctaText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
});
