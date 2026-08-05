import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api, Analytics, Audit, ActionItem, Schedule } from "@/src/api";
import { showToast } from "@/src/toast";
import { C, F, R, SP } from "@/src/theme";

const HERO_IMG = "https://images.pexels.com/photos/18415806/pexels-photo-18415806.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

function useBlink() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 550, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function OverdueBadge() {
  const opacity = useBlink();
  return (
    <Animated.View style={[styles.overdueBadge, { opacity }]} testID="overdue-badge">
      <Ionicons name="alert-circle" size={11} color={C.error} />
      <Text style={styles.overdueBadgeText}>Overdue</Text>
    </Animated.View>
  );
}

function BlinkDot() {
  const opacity = useBlink();
  return <Animated.View style={[styles.priorityDot, { backgroundColor: C.error, opacity }]} testID="overdue-blink-dot" />;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Analytics | null>(null);
  const [inProgress, setInProgress] = useState<Audit[]>([]);
  const [openActions, setOpenActions] = useState<ActionItem[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueSchedules, setDueSchedules] = useState<Schedule[]>([]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, ip, acts, scheds] = await Promise.all([
        api<Analytics>("/analytics"),
        api<Audit[]>("/audits?status=in_progress"),
        api<ActionItem[]>("/action-items?status=open"),
        api<Schedule[]>("/schedules"),
      ]);
      setStats(a);
      setInProgress(ip);
      const todayStr = new Date().toISOString().slice(0, 10);
      const isOverdue = (it: ActionItem) => !!it.due_date && it.due_date < todayStr;
      setOverdueCount(acts.filter(isOverdue).length);
      // Overdue items surface first so a stale complaint can't get buried behind newer,
      // non-urgent ones in the top-3 slice shown here.
      const sorted = [...acts].sort((x, y) => Number(isOverdue(y)) - Number(isOverdue(x)));
      setOpenActions(sorted.slice(0, 3));
      setDueSchedules(scheds.filter((s) => s.due_status === "due_today" || s.due_status === "overdue"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startScheduled = async (s: Schedule) => {
    try {
      const res = await api<{ audit: { id: string } }>(`/schedules/${s.id}/start`, { method: "POST" });
      router.push(`/audit/${res.audit.id}`);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]} testID="home-loading">
        <ActivityIndicator color={C.gold} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]} testID="home-error">
        <Text style={styles.errorText}>{error}</Text>
        <Pressable testID="home-retry-button" onPress={() => { setLoading(true); load(); }} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        testID="home-scroll"
        contentContainerStyle={{ paddingTop: insets.top + SP.md, paddingBottom: SP.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.gold} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero} testID="home-hero-card">
          <Image source={{ uri: HERO_IMG }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={["rgba(18,18,18,0.15)", "rgba(18,18,18,0.92)"]} style={StyleSheet.absoluteFill} />
          <View style={styles.heroContent} pointerEvents="box-none">
            <View style={styles.heroBrandRow}>
              <Image
                source={require("@/assets/images/logo-transparent.png")}
                style={styles.heroLogo}
                contentFit="contain"
              />
              <Text style={styles.heroKicker}>CITY PARK HOTEL</Text>
            </View>
            <Text style={styles.heroTitle}>Audit Command Center</Text>
            <Text style={styles.heroDate}>{today}</Text>
            <View style={styles.heroStatsRow}>
              <View style={styles.heroStat} testID="home-hero-avg-score">
                <Text style={styles.heroStatValue}>{stats?.avg_score != null ? `${stats.avg_score}%` : "—"}</Text>
                <Text style={styles.heroStatLabel}>Avg Score</Text>
              </View>
              <View style={styles.heroStat} testID="home-hero-completed">
                <Text style={styles.heroStatValue}>{stats?.completed_audits ?? 0}</Text>
                <Text style={styles.heroStatLabel}>Completed</Text>
              </View>
              <View style={styles.heroStat} testID="home-hero-open-actions">
                <Text style={styles.heroStatValue}>{stats?.open_actions ?? 0}</Text>
                <Text style={styles.heroStatLabel}>Open Issues</Text>
              </View>
            </View>
          </View>
          <Pressable testID="profile-button" style={styles.profileBtn} onPress={() => router.push("/profile")}>
            <Ionicons name="person-circle-outline" size={26} color={C.goldSoft} />
          </Pressable>
        </View>

        {/* Metric grid */}
        <View style={styles.grid}>
          <MetricCard testID="metric-in-progress" icon="time-outline" value={String(stats?.in_progress_audits ?? 0)} label="In Progress" />
          <MetricCard testID="metric-total" icon="documents-outline" value={String(stats?.total_audits ?? 0)} label="Total Audits" />
        </View>

        {/* Start audit CTA */}
        <Pressable testID="home-start-audit-button" style={styles.cta} onPress={() => router.push("/(tabs)/templates")}>
          <Ionicons name="add-circle-outline" size={20} color={C.onGold} />
          <Text style={styles.ctaText}>Start New Audit</Text>
        </Pressable>

        {/* Scheduled — due today */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitleInline}>Due Today</Text>
          <Pressable testID="manage-schedules-button" onPress={() => router.push("/schedules")} style={styles.manageBtn}>
            <Ionicons name="calendar-outline" size={14} color={C.gold} />
            <Text style={styles.manageText}>Schedules</Text>
          </Pressable>
        </View>
        {dueSchedules.length === 0 ? (
          <View style={styles.emptyBox} testID="home-no-due-schedules">
            <Ionicons name="calendar-clear-outline" size={22} color={C.text3} />
            <Text style={styles.emptyText}>Nothing scheduled for today</Text>
          </View>
        ) : (
          dueSchedules.map((s) => (
            <View key={s.id} style={styles.auditCard} testID={`home-schedule-${s.id}`}>
              <View style={styles.auditIconWrap}>
                <Ionicons name={(s.icon as any) || "clipboard-outline"} size={20} color={s.due_status === "overdue" ? C.error : C.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.auditName}>{s.template_name}</Text>
                <Text style={styles.auditMeta}>
                  {s.location ? `${s.location} · ` : ""}{s.recurrence === "daily" ? "Daily" : s.recurrence === "weekly" ? "Weekly" : "One-time"}
                  {s.due_status === "overdue" ? " · Overdue" : ""}
                </Text>
              </View>
              <Pressable testID={`home-schedule-start-${s.id}`} style={styles.startPill} onPress={() => startScheduled(s)}>
                <Ionicons name="play" size={12} color={C.onGold} />
                <Text style={styles.startPillText}>Start</Text>
              </Pressable>
            </View>
          ))
        )}

        {/* Continue audits */}
        <Text style={styles.sectionTitle}>Continue Audits</Text>
        {inProgress.length === 0 ? (
          <View style={styles.emptyBox} testID="home-no-in-progress">
            <Ionicons name="checkmark-done-outline" size={22} color={C.text3} />
            <Text style={styles.emptyText}>No audits in progress</Text>
          </View>
        ) : (
          inProgress.map((a) => {
            const answered = a.items.filter((i) => i.result).length;
            return (
              <Pressable
                key={a.id}
                testID={`home-audit-${a.id}`}
                style={styles.auditCard}
                onPress={() => router.push(`/audit/${a.id}`)}
              >
                <View style={styles.auditIconWrap}>
                  <Ionicons name={(a.icon as any) || "clipboard-outline"} size={20} color={C.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.auditName}>{a.template_name}</Text>
                  <Text style={styles.auditMeta}>{a.department} · {a.auditor_name}{a.location ? ` · ${a.location}` : ""}</Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${(answered / Math.max(a.items.length, 1)) * 100}%` }]} />
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.text3} />
              </Pressable>
            );
          })
        )}

        {/* Open action items */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitleInline}>Open Action Items</Text>
          {overdueCount > 0 && <OverdueBadge />}
        </View>
        {openActions.length === 0 ? (
          <View style={styles.emptyBox} testID="home-no-actions">
            <Ionicons name="shield-checkmark-outline" size={22} color={C.text3} />
            <Text style={styles.emptyText}>All clear — no open issues</Text>
          </View>
        ) : (
          openActions.map((it) => {
            const overdue = !!it.due_date && it.due_date < new Date().toISOString().slice(0, 10);
            return (
              <Pressable
                key={it.id}
                testID={`home-action-${it.id}`}
                style={[styles.actionRow, overdue && styles.actionRowOverdue]}
                onPress={() => router.push("/(tabs)/actions")}
              >
                {overdue ? (
                  <BlinkDot />
                ) : (
                  <View style={[styles.priorityDot, { backgroundColor: it.priority === "high" ? C.error : it.priority === "medium" ? C.warn : C.text3 }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle} numberOfLines={1}>{it.title}</Text>
                  <Text style={[styles.auditMeta, overdue && { color: C.error }]}>
                    {overdue ? "Overdue · " : ""}{it.department}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.text3} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function MetricCard({ icon, value, label, testID }: { icon: any; value: string; label: string; testID: string }) {
  return (
    <View style={styles.metric} testID={testID}>
      <Ionicons name={icon} size={20} color={C.gold} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: SP.md },
  errorText: { color: C.error, fontSize: 14, textAlign: "center", paddingHorizontal: SP.xl },
  retryBtn: { paddingHorizontal: SP.xl, paddingVertical: SP.md, borderRadius: R.pill, borderWidth: 1, borderColor: C.gold },
  retryText: { color: C.gold, fontSize: 14 },
  hero: { marginHorizontal: SP.lg, height: 220, borderRadius: R.lg, overflow: "hidden" },
  profileBtn: {
    position: "absolute", top: SP.md, right: SP.md, width: 40, height: 40, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  heroContent: { flex: 1, justifyContent: "flex-end", padding: SP.lg },
  heroBrandRow: { flexDirection: "row", alignItems: "center", gap: SP.xs },
  heroLogo: { width: 20, height: 20 },
  heroKicker: { color: C.goldSoft, fontSize: 11, letterSpacing: 3 },
  heroTitle: { color: C.text, fontSize: 30, fontFamily: F.display, marginTop: SP.xs },
  heroDate: { color: C.text2, fontSize: 12, marginTop: 2 },
  heroStatsRow: { flexDirection: "row", gap: SP.sm, marginTop: SP.md },
  heroStat: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: R.md,
    paddingVertical: SP.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  heroStatValue: { color: C.gold, fontSize: 18, fontFamily: F.display },
  heroStatLabel: { color: C.text2, fontSize: 10, marginTop: 1 },
  grid: { flexDirection: "row", gap: SP.md, paddingHorizontal: SP.lg, marginTop: SP.lg },
  metric: {
    flex: 1, backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg,
    borderWidth: 1, borderColor: C.border, gap: SP.xs,
  },
  metricValue: { color: C.text, fontSize: 26, fontFamily: F.display },
  metricLabel: { color: C.text3, fontSize: 12 },
  cta: {
    marginHorizontal: SP.lg, marginTop: SP.lg, backgroundColor: C.gold, borderRadius: R.md,
    minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.sm,
  },
  ctaText: { color: C.onGold, fontSize: 15, fontWeight: "500" },
  sectionTitle: { color: C.text, fontSize: 22, fontFamily: F.display, paddingHorizontal: SP.lg, marginTop: SP.xl, marginBottom: SP.md },
  sectionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SP.lg, marginTop: SP.xl, marginBottom: SP.md,
  },
  sectionTitleInline: { color: C.text, fontSize: 22, fontFamily: F.display },
  manageBtn: {
    flexDirection: "row", alignItems: "center", gap: SP.xs, borderWidth: 1, borderColor: C.goldDeep,
    borderRadius: R.pill, paddingHorizontal: SP.md, height: 32,
  },
  manageText: { color: C.gold, fontSize: 12 },
  startPill: {
    flexDirection: "row", alignItems: "center", gap: SP.xs, backgroundColor: C.gold,
    borderRadius: R.pill, paddingHorizontal: SP.md, height: 32,
  },
  startPillText: { color: C.onGold, fontSize: 12, fontWeight: "500" },
  emptyBox: {
    marginHorizontal: SP.lg, backgroundColor: C.surface, borderRadius: R.md, padding: SP.lg,
    alignItems: "center", gap: SP.xs, borderWidth: 1, borderColor: C.border,
  },
  emptyText: { color: C.text3, fontSize: 13 },
  auditCard: {
    marginHorizontal: SP.lg, marginBottom: SP.sm, backgroundColor: C.surface, borderRadius: R.md,
    padding: SP.lg, flexDirection: "row", alignItems: "center", gap: SP.md, borderWidth: 1, borderColor: C.border,
  },
  auditIconWrap: {
    width: 40, height: 40, borderRadius: R.md, backgroundColor: C.goldDeep,
    alignItems: "center", justifyContent: "center",
  },
  auditName: { color: C.text, fontSize: 15 },
  auditMeta: { color: C.text3, fontSize: 12, marginTop: 1 },
  progressTrack: { height: 4, backgroundColor: C.surface2, borderRadius: R.pill, marginTop: SP.sm, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: C.gold, borderRadius: R.pill },
  actionRow: {
    marginHorizontal: SP.lg, marginBottom: SP.sm, backgroundColor: C.surface, borderRadius: R.md,
    paddingHorizontal: SP.lg, paddingVertical: SP.md, flexDirection: "row", alignItems: "center", gap: SP.md,
    borderWidth: 1, borderColor: C.border,
  },
  actionRowOverdue: { borderColor: C.error },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  actionTitle: { color: C.text, fontSize: 14 },
  overdueBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.errorBg,
    borderRadius: R.pill, paddingHorizontal: SP.sm, paddingVertical: 4,
  },
  overdueBadgeText: { color: C.error, fontSize: 11, fontWeight: "600" },
});
