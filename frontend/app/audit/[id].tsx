import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api, Audit, AuditItem } from "@/src/api";
import { exportAuditPdf } from "@/src/pdf";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

const RESULTS = [
  { key: "pass", label: "Pass", color: C.success, bg: C.successBg, icon: "checkmark" },
  { key: "fail", label: "Fail", color: C.error, bg: C.errorBg, icon: "close" },
  { key: "na", label: "N/A", color: C.text2, bg: C.surface2, icon: "remove" },
] as const;

export default function AuditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);
  const [permBlocked, setPermBlocked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const itemsRef = React.useRef<AuditItem[]>([]);
  itemsRef.current = items;

  const load = useCallback(async () => {
    try {
      const a = await api<Audit>(`/audits/${id}`);
      setAudit(a);
      setItems(a.items);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const answered = items.filter((i) => i.result).length;
  const progress = items.length ? answered / items.length : 0;

  const sections = useMemo(() => {
    const map: { name: string; items: AuditItem[] }[] = [];
    for (const it of items) {
      let s = map.find((m) => m.name === it.section);
      if (!s) { s = { name: it.section, items: [] }; map.push(s); }
      s.items.push(it);
    }
    return map;
  }, [items]);

  const setItem = (itemId: string, patch: Partial<AuditItem>) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const itemId = photoTarget;
    if (!itemId) return;
    try {
      if (fromCamera) {
        let perm = await ImagePicker.getCameraPermissionsAsync();
        if (!perm.granted) {
          if (!perm.canAskAgain) { setPermBlocked(true); return; }
          perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { if (!perm.canAskAgain) setPermBlocked(true); return; }
        }
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.3 })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.3, mediaTypes: ["images"] });
      if (!result.canceled && result.assets[0]?.base64) {
        setItem(itemId, { photo_base64: result.assets[0].base64 });
        showToast("Photo attached");
      }
    } catch {
      showToast("Could not capture photo", "error");
    } finally {
      setPhotoTarget(null);
      setPermBlocked(false);
    }
  };

  const save = async (complete: boolean) => {
    const current = itemsRef.current;
    const answeredNow = current.filter((i) => i.result).length;
    if (complete && answeredNow < current.length) {
      showToast(`${current.length - answeredNow} checks still unanswered`, "error");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await api<Audit>(`/audits/${id}`, {
        method: "PUT",
        body: JSON.stringify({ items: current, status: complete ? "completed" : "in_progress" }),
      });
      if (complete) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setAudit(updated);
        setItems(updated.items);
        showToast("Audit completed");
      } else {
        showToast("Progress saved");
        router.back();
      }
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const generateSummary = async () => {
    setGenerating(true);
    try {
      const res = await api<{ summary: string }>(`/audits/${id}/summary`, { method: "POST" });
      setAudit((a) => (a ? { ...a, ai_summary: res.summary } : a));
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const exportPdf = async () => {
    if (!audit) return;
    setExporting(true);
    try {
      await exportAuditPdf({ ...audit, items });
    } catch {
      showToast("Could not export PDF", "error");
    } finally {
      setExporting(false);
    }
  };

  if (loading || !audit) {
    return (
      <View style={styles.center} testID="audit-loading">
        <ActivityIndicator color={C.gold} size="large" />
      </View>
    );
  }

  const isCompleted = audit.status === "completed";
  const scoreColor = audit.score == null ? C.text3 : audit.score >= 85 ? C.success : audit.score >= 60 ? C.warn : C.error;

  return (
    <View style={styles.container}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
        <View style={styles.headerRow}>
          <Pressable testID="audit-back-button" onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{audit.template_name}</Text>
            <Text style={styles.headerMeta}>
              {audit.department} · {audit.auditor_name}{audit.location ? ` · ${audit.location}` : ""}
            </Text>
          </View>
          {isCompleted && (
            <>
              <Pressable testID="export-pdf-button" style={styles.exportBtn} onPress={exportPdf} disabled={exporting}>
                {exporting ? (
                  <ActivityIndicator color={C.gold} size="small" />
                ) : (
                  <Ionicons name="download-outline" size={20} color={C.gold} />
                )}
              </Pressable>
              <View style={[styles.scoreBadge, { borderColor: scoreColor }]} testID="audit-score-badge">
                <Text style={[styles.scoreText, { color: scoreColor }]}>{audit.score != null ? Math.round(audit.score) : "—"}</Text>
              </View>
            </>
          )}
        </View>
        {!isCompleted && (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.progressText} testID="audit-progress-text">{answered}/{items.length}</Text>
          </View>
        )}
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SP.lg, paddingBottom: isCompleted ? SP.xl : 120 }}
        bottomOffset={100}
        showsVerticalScrollIndicator={false}
      >
        {/* AI summary (completed) */}
        {isCompleted && (
          <View style={styles.summaryCard} testID="ai-summary-card">
            <View style={styles.summaryHeader}>
              <Ionicons name="sparkles" size={18} color={C.gold} />
              <Text style={styles.summaryTitle}>AI Report Summary</Text>
            </View>
            {audit.ai_summary ? (
              <Text style={styles.summaryText} testID="ai-summary-text">{audit.ai_summary}</Text>
            ) : (
              <Pressable
                testID="generate-summary-button"
                style={[styles.generateBtn, generating && { opacity: 0.6 }]}
                onPress={generateSummary}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <ActivityIndicator color={C.onGold} size="small" />
                    <Text style={styles.generateText}>Writing report…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="sparkles-outline" size={16} color={C.onGold} />
                    <Text style={styles.generateText}>Generate AI Summary</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        )}

        {sections.map((section) => (
          <View key={section.name}>
            <Text style={styles.sectionTitle}>{section.name}</Text>
            {section.items.map((item) => {
              const resultMeta = RESULTS.find((r) => r.key === item.result);
              return (
                <View key={item.id} style={[styles.itemCard, isCompleted && item.result === "fail" && { borderColor: C.error }]} testID={`audit-item-${item.id}`}>
                  <Text style={styles.itemText}>{item.text}</Text>

                  {isCompleted ? (
                    <View style={styles.readonlyRow}>
                      <View style={[styles.resultPill, { backgroundColor: resultMeta?.bg || C.surface2 }]}>
                        <Text style={[styles.resultPillText, { color: resultMeta?.color || C.text3 }]}>
                          {resultMeta?.label || "Unanswered"}
                        </Text>
                      </View>
                      {!!item.note && <Text style={styles.noteReadonly}>“{item.note}”</Text>}
                    </View>
                  ) : (
                    <>
                      <View style={styles.segmentRow}>
                        {RESULTS.map((r) => {
                          const active = item.result === r.key;
                          return (
                            <Pressable
                              key={r.key}
                              testID={`item-${item.id}-${r.key}`}
                              style={[styles.segBtn, active && { backgroundColor: r.bg, borderColor: r.color }]}
                              onPress={() => {
                                Haptics.selectionAsync();
                                setItem(item.id, { result: active ? null : r.key });
                              }}
                            >
                              <Ionicons name={r.icon as any} size={15} color={active ? r.color : C.text3} />
                              <Text style={[styles.segText, active && { color: r.color }]}>{r.label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.toolRow}>
                        <Pressable
                          testID={`item-${item.id}-note-button`}
                          style={styles.toolBtn}
                          onPress={() => setNoteOpen((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        >
                          <Ionicons name="create-outline" size={16} color={item.note ? C.gold : C.text3} />
                          <Text style={[styles.toolText, item.note ? { color: C.gold } : null]}>Note</Text>
                        </Pressable>
                        <Pressable
                          testID={`item-${item.id}-photo-button`}
                          style={styles.toolBtn}
                          onPress={() => setPhotoTarget(item.id)}
                        >
                          <Ionicons name="camera-outline" size={16} color={item.photo_base64 ? C.gold : C.text3} />
                          <Text style={[styles.toolText, item.photo_base64 ? { color: C.gold } : null]}>Photo</Text>
                        </Pressable>
                      </View>
                      {(noteOpen[item.id] || !!item.note) && (
                        <TextInput
                          testID={`item-${item.id}-note-input`}
                          style={styles.noteInput}
                          placeholder="Add a note…"
                          placeholderTextColor={C.text3}
                          value={item.note}
                          onChangeText={(t) => setItem(item.id, { note: t })}
                          multiline
                        />
                      )}
                    </>
                  )}

                  {item.photo_base64 && (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${item.photo_base64}` }}
                      style={styles.photo}
                      contentFit="cover"
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </KeyboardAwareScrollView>

      {/* Sticky CTA */}
      {!isCompleted && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + SP.md }]}>
          <Pressable
            testID="save-exit-button"
            style={styles.saveBtn}
            onPress={() => save(false)}
            disabled={submitting}
          >
            <Text style={styles.saveText}>Save & Exit</Text>
          </Pressable>
          <Pressable
            testID="submit-audit-button"
            style={[styles.submitBtn, (submitting || answered < items.length) && { opacity: 0.5 }]}
            onPress={() => save(true)}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.submitText}>Complete Audit</Text>}
          </Pressable>
        </View>
      )}

      {/* Photo source sheet */}
      <Modal visible={!!photoTarget} transparent animationType="slide" onRequestClose={() => setPhotoTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => { setPhotoTarget(null); setPermBlocked(false); }} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Attach Photo Evidence</Text>
            {permBlocked ? (
              <>
                <Text style={styles.sheetSub}>Camera access is blocked. Enable it in Settings to take photos.</Text>
                <Pressable testID="open-settings-button" style={styles.sheetOption} onPress={() => Linking.openSettings()}>
                  <Ionicons name="settings-outline" size={20} color={C.gold} />
                  <Text style={styles.sheetOptionText}>Open Settings</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.sheetSub}>Photos help document issues found during the audit.</Text>
            )}
            <Pressable testID="photo-camera-button" style={styles.sheetOption} onPress={() => pickPhoto(true)}>
              <Ionicons name="camera-outline" size={20} color={C.gold} />
              <Text style={styles.sheetOptionText}>Take Photo</Text>
            </Pressable>
            <Pressable testID="photo-library-button" style={styles.sheetOption} onPress={() => pickPhoto(false)}>
              <Ionicons name="images-outline" size={20} color={C.gold} />
              <Text style={styles.sheetOptionText}>Choose from Library</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: "#181818", borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: SP.lg, paddingBottom: SP.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -SP.sm },
  headerTitle: { color: C.text, fontSize: 22, fontFamily: F.display },
  headerMeta: { color: C.text3, fontSize: 12 },
  scoreBadge: { width: 44, height: 44, borderRadius: R.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  exportBtn: {
    width: 40, height: 40, borderRadius: R.md, backgroundColor: C.surface2, borderWidth: 1,
    borderColor: C.goldDeep, alignItems: "center", justifyContent: "center",
  },
  scoreText: { fontSize: 15, fontFamily: F.display },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: SP.md, marginTop: SP.sm },
  progressTrack: { flex: 1, height: 5, backgroundColor: C.surface2, borderRadius: R.pill, overflow: "hidden" },
  progressFill: { height: 5, backgroundColor: C.gold, borderRadius: R.pill },
  progressText: { color: C.text2, fontSize: 12 },
  sectionTitle: { color: C.goldSoft, fontSize: 20, fontFamily: F.display, marginTop: SP.lg, marginBottom: SP.sm },
  itemCard: {
    backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, marginBottom: SP.sm,
    borderWidth: 1, borderColor: C.border, gap: SP.md,
  },
  itemText: { color: C.text, fontSize: 14, lineHeight: 20 },
  segmentRow: { flexDirection: "row", gap: SP.sm },
  segBtn: {
    flex: 1, height: 40, borderRadius: R.md, backgroundColor: C.surface2, borderWidth: 1,
    borderColor: C.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.xs,
  },
  segText: { color: C.text3, fontSize: 13 },
  toolRow: { flexDirection: "row", gap: SP.lg },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: SP.xs, minHeight: 32 },
  toolText: { color: C.text3, fontSize: 13 },
  noteInput: {
    backgroundColor: C.surface2, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    color: C.text, paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: 44, fontSize: 14,
  },
  photo: { width: "100%", height: 140, borderRadius: R.md },
  readonlyRow: { gap: SP.sm },
  resultPill: { alignSelf: "flex-start", paddingHorizontal: SP.md, paddingVertical: 4, borderRadius: R.pill },
  resultPillText: { fontSize: 12 },
  noteReadonly: { color: C.text2, fontSize: 13, fontStyle: "italic" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: SP.md,
    paddingHorizontal: SP.lg, paddingTop: SP.md, backgroundColor: "rgba(24,24,24,0.97)",
    borderTopWidth: 1, borderTopColor: C.border,
  },
  saveBtn: {
    flex: 1, minHeight: 50, borderRadius: R.md, borderWidth: 1, borderColor: C.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  saveText: { color: C.text2, fontSize: 14 },
  submitBtn: { flex: 2, minHeight: 50, borderRadius: R.md, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  submitText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
  summaryCard: {
    backgroundColor: C.surface, borderRadius: R.lg, padding: SP.xl, borderWidth: 1, borderColor: C.goldDeep,
    gap: SP.md, marginBottom: SP.sm,
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  summaryTitle: { color: C.text, fontSize: 22, fontFamily: F.display },
  summaryText: { color: C.text2, fontSize: 14, lineHeight: 24 },
  generateBtn: {
    backgroundColor: C.gold, borderRadius: R.md, minHeight: 46,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.sm,
  },
  generateText: { color: C.onGold, fontSize: 14, fontWeight: "500" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: SP.xl, gap: SP.md,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: R.pill, backgroundColor: C.borderStrong },
  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.display },
  sheetSub: { color: C.text3, fontSize: 13 },
  sheetOption: {
    flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface2,
    borderRadius: R.md, paddingHorizontal: SP.lg, minHeight: 52, borderWidth: 1, borderColor: C.border,
  },
  sheetOptionText: { color: C.text, fontSize: 15 },
});
