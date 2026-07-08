import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, Analytics, Audit, RoomCoverage } from "@/src/api";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"trends" | "coverage" | "history">("trends");
  const [stats, setStats] = useState<Analytics | null>(null);
  const [history, setHistory] = useState<Audit[]>([]);
  const [coverage, setCoverage] = useState<RoomCoverage | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, h, cov] = await Promise.all([
        api<Analytics>("/analytics"),
        api<Audit[]>("/audits?status=completed"),
        api<RoomCoverage>("/analytics/room-coverage?days=7"),
      ]);
      setStats(a);
      setHistory(h);
      setCoverage(cov);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const scoreColor = (s: number | null) =>
    s == null ? C.text3 : s >= 85 ? C.success : s >= 60 ? C.warn : C.error;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.headerTitle}>Analytics</Text>
        <View style={styles.segment}>
          <Pressable
            testID="analytics-tab-trends"
            style={[styles.segmentBtn, tab === "trends" && styles.segmentActive]}
            onPress={() => setTab("trends")}
          >
            <Text style={[styles.segmentText, tab === "trends" && styles.segmentTextActive]}>Trends</Text>
          </Pressable>
          <Pressable
            testID="analytics-tab-coverage"
            style={[styles.segmentBtn, tab === "coverage" && styles.segmentActive]}
            onPress={() => setTab("coverage")}
          >
            <Text style={[styles.segmentText, tab === "coverage" && styles.segmentTextActive]}>Coverage</Text>
          </Pressable>
          <Pressable
            testID="analytics-tab-history"
            style={[styles.segmentBtn, tab === "history" && styles.segmentActive]}
            onPress={() => setTab("history")}
          >
            <Text style={[styles.segmentText, tab === "history" && styles.segmentTextActive]}>History</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.gold} size="large" /></View>
      ) : tab === "trends" ? (
        <ScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xl }} showsVerticalScrollIndicator={false} testID="trends-view">
          {/* Big score */}
          <View style={styles.bigCard} testID="analytics-avg-score-card">
            <Text style={styles.bigLabel}>PORTFOLIO SCORE</Text>
            <Text style={[styles.bigValue, { color: scoreColor(stats?.avg_score ?? null) }]}>
              {stats?.avg_score != null ? `${stats.avg_score}%` : "—"}
            </Text>
            <Text style={styles.bigSub}>
              {stats?.completed_audits ?? 0} completed audits · {stats?.open_actions ?? 0} open issues
            </Text>
          </View>

          {/* Trend bars */}
          <Text style={styles.sectionTitle}>Score Trend</Text>
          {stats && stats.trend.length > 0 ? (
            <View style={styles.trendCard} testID="trend-chart">
              <View style={styles.trendRow}>
                {stats.trend.map((t, i) => (
                  <View key={i} style={styles.trendCol}>
                    <Text style={styles.trendVal}>{Math.round(t.score)}</Text>
                    <View style={styles.trendTrack}>
                      <View style={[styles.trendFill, { height: `${Math.max(t.score, 4)}%`, backgroundColor: scoreColor(t.score) === C.text3 ? C.gold : scoreColor(t.score) }]} />
                    </View>
                  </View>
                ))}
              </View>
              <Text style={styles.trendHint}>Last {stats.trend.length} completed audits</Text>
            </View>
          ) : (
            <View style={styles.emptyBox} testID="trend-empty">
              <Ionicons name="analytics-outline" size={26} color={C.text3} />
              <Text style={styles.emptyText}>Complete audits to see trends</Text>
            </View>
          )}

          {/* Department scores */}
          <Text style={styles.sectionTitle}>Department Scores</Text>
          {stats && stats.dept_scores.length > 0 ? (
            stats.dept_scores.map((d) => (
              <View key={d.department} style={styles.deptRow} testID={`dept-score-${d.department.toLowerCase().replace(/\s+/g, "-")}`}>
                <View style={styles.deptTop}>
                  <Text style={styles.deptName}>{d.department}</Text>
                  <Text style={[styles.deptScore, { color: scoreColor(d.avg_score) }]}>{d.avg_score}%</Text>
                </View>
                <View style={styles.deptTrack}>
                  <View style={[styles.deptFill, { width: `${d.avg_score}%`, backgroundColor: scoreColor(d.avg_score) }]} />
                </View>
                <Text style={styles.deptCount}>{d.count} audit{d.count > 1 ? "s" : ""}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyBox} testID="dept-empty">
              <Ionicons name="business-outline" size={26} color={C.text3} />
              <Text style={styles.emptyText}>No department data yet</Text>
            </View>
          )}
        </ScrollView>
      ) : tab === "coverage" ? (
        <ScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xl }} showsVerticalScrollIndicator={false} testID="coverage-view">
          <View style={styles.bigCard} testID="coverage-summary-card">
            <Text style={styles.bigLabel}>ROOM COVERAGE — LAST 7 DAYS</Text>
            <Text style={[styles.bigValue, { color: (coverage?.coverage_pct ?? 0) >= 80 ? C.success : (coverage?.coverage_pct ?? 0) >= 40 ? C.warn : C.error }]}>
              {coverage ? `${Math.round(coverage.coverage_pct)}%` : "—"}
            </Text>
            <Text style={styles.bigSub}>
              {coverage?.audited_rooms ?? 0} of {coverage?.total_rooms ?? 0} rooms audited this week
            </Text>
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.successBg, borderColor: C.success }]} />
              <Text style={styles.legendText}>Audited</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.surface2, borderColor: C.border }]} />
              <Text style={styles.legendText}>Not audited</Text>
            </View>
          </View>

          {coverage?.floors.map((f) => {
            const done = f.rooms.filter((r) => r.audited).length;
            return (
              <View key={f.floor} style={styles.floorCard} testID={`coverage-floor-${f.floor.toLowerCase().replace(/\s+/g, "-")}`}>
                <View style={styles.floorHeader}>
                  <Text style={styles.floorName}>{f.floor}</Text>
                  <Text style={styles.floorCount}>{done}/{f.rooms.length}</Text>
                </View>
                <View style={styles.roomGrid}>
                  {f.rooms.map((r) => (
                    <View
                      key={r.room}
                      testID={`coverage-room-${r.room}`}
                      style={[styles.roomCell, r.audited ? styles.roomCellDone : null]}
                    >
                      <Text style={[styles.roomCellText, r.audited && { color: C.success }]}>{r.room}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <FlatList
          testID="history-list"
          data={history}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xl }}
          ListEmptyComponent={
            <View style={styles.emptyBox} testID="history-empty">
              <Ionicons name="time-outline" size={26} color={C.text3} />
              <Text style={styles.emptyText}>No completed audits yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`history-audit-${item.id}`}
              style={styles.historyCard}
              onPress={() => router.push(`/audit/${item.id}`)}
            >
              <View style={[styles.scoreBadge, { borderColor: scoreColor(item.score) }]}>
                <Text style={[styles.scoreBadgeText, { color: scoreColor(item.score) }]}>
                  {item.score != null ? Math.round(item.score) : "—"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyName}>{item.template_name}</Text>
                <Text style={styles.historyMeta}>
                  {item.department}{item.location ? ` · ${item.location}` : ""} · {item.auditor_name} · {item.completed_at ? new Date(item.completed_at).toLocaleDateString() : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.text3} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: "#181818", borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: SP.lg, paddingBottom: SP.md, gap: SP.md,
  },
  headerTitle: { color: C.text, fontSize: 28, fontFamily: F.display },
  segment: { flexDirection: "row", backgroundColor: C.surface, borderRadius: R.md, padding: 4, borderWidth: 1, borderColor: C.border },
  segmentBtn: { flex: 1, height: 36, borderRadius: R.sm, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: C.gold },
  segmentText: { color: C.text2, fontSize: 13 },
  segmentTextActive: { color: C.onGold },
  bigCard: {
    backgroundColor: C.surface, borderRadius: R.lg, padding: SP.xl, alignItems: "center",
    borderWidth: 1, borderColor: C.border,
  },
  bigLabel: { color: C.goldSoft, fontSize: 11, letterSpacing: 3 },
  bigValue: { fontSize: 56, fontFamily: F.display, marginTop: SP.xs },
  bigSub: { color: C.text3, fontSize: 12 },
  sectionTitle: { color: C.text, fontSize: 22, fontFamily: F.display, marginTop: SP.xl, marginBottom: SP.md },
  trendCard: { backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, borderWidth: 1, borderColor: C.border },
  trendRow: { flexDirection: "row", gap: SP.sm, height: 130, alignItems: "flex-end" },
  trendCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 },
  trendVal: { color: C.text3, fontSize: 10 },
  trendTrack: { width: "70%", flex: 1, backgroundColor: C.surface2, borderRadius: R.sm, justifyContent: "flex-end", overflow: "hidden" },
  trendFill: { width: "100%", borderRadius: R.sm },
  trendHint: { color: C.text3, fontSize: 11, marginTop: SP.sm, textAlign: "center" },
  deptRow: { backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, marginBottom: SP.sm, borderWidth: 1, borderColor: C.border },
  deptTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: SP.sm },
  deptName: { color: C.text, fontSize: 14 },
  deptScore: { fontSize: 14, fontWeight: "500" },
  deptTrack: { height: 6, backgroundColor: C.surface2, borderRadius: R.pill, overflow: "hidden" },
  deptFill: { height: 6, borderRadius: R.pill },
  deptCount: { color: C.text3, fontSize: 11, marginTop: SP.xs },
  emptyBox: {
    backgroundColor: C.surface, borderRadius: R.md, padding: SP.xl, alignItems: "center", gap: SP.sm,
    borderWidth: 1, borderColor: C.border,
  },
  emptyText: { color: C.text3, fontSize: 13 },
  historyCard: {
    backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, marginBottom: SP.sm,
    flexDirection: "row", alignItems: "center", gap: SP.md, borderWidth: 1, borderColor: C.border,
  },
  scoreBadge: {
    width: 46, height: 46, borderRadius: R.pill, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  scoreBadgeText: { fontSize: 15, fontFamily: F.display },
  historyName: { color: C.text, fontSize: 15 },
  historyMeta: { color: C.text3, fontSize: 12, marginTop: 2 },
  legendRow: { flexDirection: "row", gap: SP.lg, marginTop: SP.lg, marginBottom: SP.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: SP.xs },
  legendDot: { width: 14, height: 14, borderRadius: R.sm / 2, borderWidth: 1 },
  legendText: { color: C.text3, fontSize: 12 },
  floorCard: {
    backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg, marginTop: SP.md,
    borderWidth: 1, borderColor: C.border,
  },
  floorHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SP.md },
  floorName: { color: C.goldSoft, fontSize: 18, fontFamily: F.display },
  floorCount: { color: C.text3, fontSize: 12 },
  roomGrid: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  roomCell: {
    width: 52, height: 34, borderRadius: R.sm, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  roomCellDone: { backgroundColor: C.successBg, borderColor: C.success },
  roomCellText: { color: C.text3, fontSize: 12 },
});
