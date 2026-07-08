import React, { useState } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

interface DraftSection { name: string; items: string[]; }

export default function CreateTemplateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [sections, setSections] = useState<DraftSection[]>([{ name: "", items: [""] }]);
  const [saving, setSaving] = useState(false);

  const updateSection = (idx: number, patch: Partial<DraftSection>) => {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const save = async () => {
    if (!name.trim() || !department.trim()) {
      showToast("Name and department are required", "error");
      return;
    }
    const cleaned = sections
      .map((s) => ({ name: s.name.trim(), items: s.items.map((t) => t.trim()).filter(Boolean).map((text) => ({ text })) }))
      .filter((s) => s.name && s.items.length > 0);
    if (cleaned.length === 0) {
      showToast("Add at least one section with checks", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), department: department.trim(), icon: "clipboard-outline", sections: cleaned }),
      });
      showToast("Template created");
      router.back();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
        <Pressable testID="create-template-back-button" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>New Template</Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: SP.lg, paddingBottom: 140 }}
        bottomOffset={90}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.label}>Template Name</Text>
        <TextInput
          testID="template-name-input"
          style={styles.input}
          placeholder="e.g. Spa & Salon Inspection"
          placeholderTextColor={C.text3}
          value={name}
          onChangeText={setName}
        />
        <Text style={styles.label}>Department</Text>
        <TextInput
          testID="template-dept-input"
          style={styles.input}
          placeholder="e.g. Wellness"
          placeholderTextColor={C.text3}
          value={department}
          onChangeText={setDepartment}
        />

        {sections.map((section, sIdx) => (
          <View key={sIdx} style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <TextInput
                testID={`section-name-input-${sIdx}`}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder={`Section ${sIdx + 1} name`}
                placeholderTextColor={C.text3}
                value={section.name}
                onChangeText={(t) => updateSection(sIdx, { name: t })}
              />
              {sections.length > 1 && (
                <Pressable
                  testID={`remove-section-${sIdx}`}
                  style={styles.removeBtn}
                  onPress={() => setSections((prev) => prev.filter((_, i) => i !== sIdx))}
                >
                  <Ionicons name="trash-outline" size={18} color={C.error} />
                </Pressable>
              )}
            </View>
            {section.items.map((item, iIdx) => (
              <View key={iIdx} style={styles.itemRow}>
                <TextInput
                  testID={`item-input-${sIdx}-${iIdx}`}
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder={`Check item ${iIdx + 1}`}
                  placeholderTextColor={C.text3}
                  value={item}
                  onChangeText={(t) =>
                    updateSection(sIdx, { items: section.items.map((x, i) => (i === iIdx ? t : x)) })
                  }
                />
                {section.items.length > 1 && (
                  <Pressable
                    testID={`remove-item-${sIdx}-${iIdx}`}
                    style={styles.removeBtn}
                    onPress={() => updateSection(sIdx, { items: section.items.filter((_, i) => i !== iIdx) })}
                  >
                    <Ionicons name="close" size={18} color={C.text3} />
                  </Pressable>
                )}
              </View>
            ))}
            <Pressable
              testID={`add-item-button-${sIdx}`}
              style={styles.addRowBtn}
              onPress={() => updateSection(sIdx, { items: [...section.items, ""] })}
            >
              <Ionicons name="add" size={16} color={C.gold} />
              <Text style={styles.addRowText}>Add check</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          testID="add-section-button"
          style={styles.addSectionBtn}
          onPress={() => setSections((prev) => [...prev, { name: "", items: [""] }])}
        >
          <Ionicons name="add-circle-outline" size={18} color={C.gold} />
          <Text style={styles.addRowText}>Add section</Text>
        </Pressable>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={[styles.footer, { paddingBottom: insets.bottom + SP.md }]}>
          <Pressable testID="save-template-button" style={[styles.cta, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.ctaText}>Save Template</Text>}
          </Pressable>
        </View>
      </KeyboardStickyView>
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
  label: { color: C.text2, fontSize: 13, marginBottom: SP.sm, marginTop: SP.md },
  input: {
    backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    color: C.text, paddingHorizontal: SP.lg, minHeight: 48, fontSize: 15, marginBottom: SP.sm,
  },
  sectionCard: {
    backgroundColor: C.surface2, borderRadius: R.lg, padding: SP.lg, marginTop: SP.lg,
    borderWidth: 1, borderColor: C.border, gap: SP.sm,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  removeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  addRowBtn: { flexDirection: "row", alignItems: "center", gap: SP.xs, minHeight: 40 },
  addRowText: { color: C.gold, fontSize: 14 },
  addSectionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.sm, marginTop: SP.lg,
    minHeight: 48, borderRadius: R.md, borderWidth: 1, borderColor: C.goldDeep, borderStyle: "dashed",
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: SP.lg, paddingTop: SP.md,
    backgroundColor: "rgba(24,24,24,0.97)", borderTopWidth: 1, borderTopColor: C.border,
  },
  cta: { backgroundColor: C.gold, borderRadius: R.md, minHeight: 50, alignItems: "center", justifyContent: "center" },
  ctaText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
});
