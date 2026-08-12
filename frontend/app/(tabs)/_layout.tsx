import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C } from "@/src/theme";

const isLiquidGlassIOS =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

export default function TabLayout() {
  if (isLiquidGlassIOS) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeTabs, Icon, Label } = require("expo-router/unstable-native-tabs");
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="home">
          <Icon sf="house.fill" />
          <Label>Home</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="templates">
          <Icon sf="checklist" />
          <Label>Templates</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="actions">
          <Icon sf="exclamationmark.circle" />
          <Label>Actions</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="analytics">
          <Icon sf="chart.bar.fill" />
          <Label>Analytics</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.gold,
        tabBarInactiveTintColor: C.text3,
        tabBarStyle: {
          backgroundColor: "#181818",
          borderTopColor: C.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="templates"
        options={{
          title: "Templates",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "clipboard" : "clipboard-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="actions"
        options={{
          title: "Actions",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "alert-circle" : "alert-circle-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: "Analytics",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "stats-chart" : "stats-chart-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
