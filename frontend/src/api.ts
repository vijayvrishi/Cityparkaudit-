const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export interface User {
  id: string; name: string; email: string; role: "admin" | "auditor";
  approved: boolean; created_at: string;
}
export interface TeamMember { id: string; name: string; role: "admin" | "auditor"; }
export interface TemplateItem { id: string; text: string; }
export interface TemplateSection { name: string; items: TemplateItem[]; }
export interface Template {
  id: string; name: string; department: string; icon: string;
  sections: TemplateSection[]; created_at: string;
}
export interface Locations {
  floors: { floor: string; rooms: string[] }[];
  areas: string[];
}
export interface AuditItem {
  id: string; text: string; section: string;
  result: "pass" | "fail" | "na" | null; note: string; photo_base64: string | null;
}
export interface Audit {
  id: string; template_id: string; template_name: string; department: string; icon: string;
  auditor_name: string; location: string | null; status: "in_progress" | "completed"; items: AuditItem[];
  score: number | null; ai_summary: string | null; started_at: string; completed_at: string | null;
  created_by?: string;
}
export interface ActionItem {
  id: string; title: string; description: string; department: string;
  priority: "low" | "medium" | "high"; status: "open" | "in_progress" | "resolved";
  audit_id: string | null; location?: string | null;
  assignee?: string | null; due_date?: string | null; created_at: string;
}
export interface Schedule {
  id: string; template_id: string; template_name: string; department: string; icon: string;
  location: string | null; auditor_name: string; recurrence: "once" | "daily" | "weekly";
  next_due: string; active: boolean; created_at: string;
  due_status?: "overdue" | "due_today" | "upcoming" | "paused";
}
export interface RoomCoverage {
  days: number; total_rooms: number; audited_rooms: number; coverage_pct: number;
  floors: { floor: string; rooms: { room: string; audited: boolean; last_audit: string | null; score: number | null }[] }[];
}
export interface Analytics {
  total_audits: number; completed_audits: number; in_progress_audits: number;
  avg_score: number | null; open_actions: number;
  dept_scores: { department: string; avg_score: number; count: number }[];
  trend: { date: string; score: number; name: string }[];
}
