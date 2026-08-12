import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { api, Template, Locations } from "@/src/api";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dept, setDept] = useState("All");
  const [startTarget, setStartTarget] = useState<Template | null>(null);
  const [auditorName, setAuditorName] = useState("");
  const [starting, setStarting] = useState(false);
  const [locations, setLocations] = useState<Locations | null>(null);
  const [locTab, setLocTab] = useState<"rooms" | "areas">("rooms");
  const [floorIdx, setFloorIdx] = useState(0);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, locs] = await Promise.all([api<Template[]>("/templates"), api<Locations>("/locations")]);
      setTemplates(t);
      setLocations(locs);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const depts = useMemo(() => ["All", ...Array.from(new Set(templates.map((t) => t.department)))], [templates]);
  const filtered = dept === "All" ? templates : templates.filter((t) => t.department === dept);

  const startAudit = async () => {
    if (!startTarget) return;
    setStarting(true);
    try {
      const audit = await api("/audits", {
        method: "POST",
        body: JSON.stringify({
          template_id: startTarget.id,
          auditor_name: auditorName.trim() || "Auditor",
          location: selectedLoc,
        }),
      });
      setStartTarget(null);
      setAuditorName("");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(`/audit/${audit.id}`);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Templates</Text>
          <Pressable testID="new-template-button" style={styles.addBtn} onPress={() => router.push("/create-template")}>
            <Ionicons name="add" size={22} color={C.onGold} />
          </Pressable>
        </View>
        <View style={styles.chipRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {depts.map((d) => (
              <Pressable
                key={d}
                testID={`dept-chip-${d.toLowerCase().replace(/\s+/g, "-")}`}
                onPress={() => setDept(d)}
                style={[styles.chip, dept === d && styles.chipActive]}
              >
                <Text style={[styles.chipText, dept === d && styles.chipTextActive]}>{d}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.gold} size="large" /></View>
      ) : (
        <FlatList
          testID="templates-list"
          data={filtered}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: SP.xl }}
          ListEmptyComponent={
            <View style={styles.emptyBox} testID="templates-empty">
              <Ionicons name="clipboard-outline" size={28} color={C.text3} />
              <Text style={styles.emptyText}>No templates yet. Tap + to create one.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const itemCount = item.sections.reduce((n, s) => n + s.items.length, 0);
            return (
              <View style={styles.card} testID={`template-card-${item.id}`}>
                <View style={styles.cardTop}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={(item.icon as any) || "clipboard-outline"} size={22} color={C.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <Text style={styles.cardMeta}>{item.department} · {item.sections.length} sections · {itemCount} checks</Text>
                  </View>
                </View>
                <Pressable
                  testID={`start-audit-button-${item.id}`}
                  style={styles.startBtn}
                  onPress={() => {
                    setStartTarget(item);
                    setAuditorName("");
                    setSelectedLoc(null);
                    setFloorIdx(0);
                    setLocTab(item.department === "Food & Beverage" ? "areas" : "rooms");
                  }}
                >
                  <Ionicons name="play" size={14} color={C.onGold} />
                  <Text style={styles.startText}>Start Audit</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}

      {/* Auditor name bottom sheet */}
      <Modal visible={!!startTarget} transparent animationType="slide" onRequestClose={() => setStartTarget(null)}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setStartTarget(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{startTarget?.name}</Text>
            <Text style={styles.sheetSub}>Who is performing this audit?</Text>
            <TextInput
              testID="auditor-name-input"
              style={styles.input}
              placeholder="Auditor name"
              placeholderTextColor={C.text3}
              value={auditorName}
              onChangeText={setAuditorName}
            />

            <Text style={styles.sheetSub}>Location {selectedLoc ? `— ${selectedLoc}` : "(optional)"}</Text>
            <View style={styles.locSegment}>
              <Pressable
                testID="loc-tab-rooms"
                style={[styles.locSegBtn, locTab === "rooms" && styles.locSegActive]}
                onPress={() => setLocTab("rooms")}
              >
                <Text style={[styles.locSegText, locTab === "rooms" && { color: C.onGold }]}>Rooms</Text>
              </Pressable>
              <Pressable
                testID="loc-tab-areas"
                style={[styles.locSegBtn, locTab === "areas" && styles.locSegActive]}
                onPress={() => setLocTab("areas")}
              >
                <Text style={[styles.locSegText, locTab === "areas" && { color: C.onGold }]}>Kitchens & Outlets</Text>
              </Pressable>
            </View>

            {locTab === "rooms" && locations && (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorRow}>
                  {locations.floors.map((f, i) => (
                    <Pressable
                      key={f.floor}
                      testID={`floor-chip-${i}`}
                      style={[styles.floorChip, floorIdx === i && styles.floorChipActive]}
                      onPress={() => setFloorIdx(i)}
                    >
                      <Text style={[styles.floorChipText, floorIdx === i && { color: C.onGold }]}>{f.floor}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView style={{ maxHeight: 150 }} showsVerticalScrollIndicator={false}>
                  <View style={styles.roomGrid}>
                    {locations.floors[floorIdx]?.rooms.map((r) => {
                      const label = `Room ${r}`;
                      const active = selectedLoc === label;
                      return (
                        <Pressable
                          key={r}
                          testID={`room-chip-${r}`}
                          style={[styles.roomChip, active && styles.roomChipActive]}
                          onPress={() => setSelectedLoc(active ? null : label)}
                        >
                          <Text style={[styles.roomChipText, active && { color: C.onGold }]}>{r}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            )}

            {locTab === "areas" && locations && (
              <View style={styles.roomGrid}>
                {locations.areas.map((a) => {
                  const active = selectedLoc === a;
                  return (
                    <Pressable
                      key={a}
                      testID={`area-chip-${a.toLowerCase().replace(/\s+/g, "-")}`}
                      style={[styles.areaChip, active && styles.roomChipActive]}
                      onPress={() => setSelectedLoc(active ? null : a)}
                    >
                      <Text style={[styles.roomChipText, active && { color: C.onGold }]}>{a}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Pressable
              testID="confirm-start-audit-button"
              style={[styles.cta, starting && { opacity: 0.6 }]}
              onPress={startAudit}
              disabled={starting}
            >
              {starting ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.ctaText}>Begin Audit</Text>}
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
    backgroundColor: C.surface, borderRadius: R.lg, padding: SP.lg, marginBottom: SP.md,
    borderWidth: 1, borderColor: C.border,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: SP.md },
  iconWrap: { width: 46, height: 46, borderRadius: R.md, backgroundColor: C.goldDeep, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: C.text, fontSize: 20, fontFamily: F.display },
  cardMeta: { color: C.text3, fontSize: 12, marginTop: 2 },
  startBtn: {
    marginTop: SP.md, backgroundColor: C.gold, borderRadius: R.md, minHeight: 44,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.sm,
  },
  startText: { color: C.onGold, fontSize: 14, fontWeight: "500" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: SP.xl, gap: SP.md,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: R.pill, backgroundColor: C.borderStrong },
  sheetTitle: { color: C.text, fontSize: 24, fontFamily: F.display },
  sheetSub: { color: C.text3, fontSize: 13 },
  input: {
    backgroundColor: C.surface2, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    color: C.text, paddingHorizontal: SP.lg, minHeight: 48, fontSize: 15,
  },
  cta: { backgroundColor: C.gold, borderRadius: R.md, minHeight: 50, alignItems: "center", justifyContent: "center" },
  ctaText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
  locSegment: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: R.md, padding: 4, borderWidth: 1, borderColor: C.border },
  locSegBtn: { flex: 1, height: 34, borderRadius: R.sm, alignItems: "center", justifyContent: "center" },
  locSegActive: { backgroundColor: C.gold },
  locSegText: { color: C.text2, fontSize: 12 },
  floorRow: { gap: SP.sm },
  floorChip: {
    height: 32, paddingHorizontal: SP.md, borderRadius: R.pill, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  floorChipActive: { backgroundColor: C.gold, borderColor: C.gold },
  floorChipText: { color: C.text2, fontSize: 12 },
  roomGrid: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  roomChip: {
    width: 56, height: 36, borderRadius: R.sm, backgroundColor: C.surface2, borderWidth: 1,
    borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  roomChipActive: { backgroundColor: C.gold, borderColor: C.gold },
  roomChipText: { color: C.text2, fontSize: 13 },
  areaChip: {
    paddingHorizontal: SP.md, height: 36, borderRadius: R.sm, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
});
