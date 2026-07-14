import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Audit, AuditItem } from "./api";
import { PDF_LOGO_BASE64 } from "./pdf-logo";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const RESPONSE_STYLE: Record<string, { label: string; color: string }> = {
  pass: { label: "DONE", color: "#1e7d45" },
  fail: { label: "FAILED", color: "#b03030" },
  na: { label: "N/A", color: "#777777" },
};

function scoreLabel(it: AuditItem): string {
  if (it.result === "na" || !it.result) return "N/A";
  return it.result === "pass" ? "(1/1)" : "(0/1)";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function buildAuditHtml(audit: Audit): string {
  const sections: { name: string; items: AuditItem[] }[] = [];
  for (const it of audit.items) {
    let s = sections.find((x) => x.name === it.section);
    if (!s) { s = { name: it.section, items: [] }; sections.push(s); }
    s.items.push(it);
  }

  const sectionStats = sections.map((sec) => {
    const scored = sec.items.filter((i) => i.result === "pass" || i.result === "fail");
    const actual = sec.items.filter((i) => i.result === "pass").length;
    const target = scored.length;
    const pct = target ? (actual / target) * 100 : 100;
    return { name: sec.name, actual, target, pct };
  });

  const scorePct = audit.score != null ? Math.round(audit.score * 10) / 10 : null;
  const scoreColor = scorePct == null ? "#666" : scorePct >= 85 ? "#1e7d45" : scorePct >= 60 ? "#a97b12" : "#b03030";
  const totalActual = sectionStats.reduce((s, x) => s + x.actual, 0);
  const totalTarget = sectionStats.reduce((s, x) => s + x.target, 0);
  const completedDate = audit.completed_at ? fmtDate(audit.completed_at) : fmtDate(audit.started_at);

  const barsHtml = sectionStats.map((s) => `
    <div class="bar-row">
      <div class="bar-label">${esc(s.name)}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max(s.pct, 2)}%"></div>
        <span class="bar-value">${s.pct.toFixed(1)}% (${s.actual.toFixed(1)} of ${s.target.toFixed(1)})</span>
      </div>
    </div>
  `).join("");

  const sectionTableRows = sectionStats.map((s) => `
    <tr><td>${esc(s.name)}</td><td>${s.actual.toFixed(1)}</td><td>${s.target.toFixed(1)}</td><td>${s.pct.toFixed(1)}</td></tr>
  `).join("");

  let qNum = 0;
  const sectionsHtml = sections.map((sec, idx) => {
    const stat = sectionStats[idx];
    const rows = sec.items.map((it) => {
      qNum += 1;
      const resp = RESPONSE_STYLE[it.result || ""] || { label: "—", color: "#999" };
      return `
      <tr class="qrow">
        <td class="qnum">${qNum}</td>
        <td class="qtext">
          ${esc(it.text)}
          ${it.note ? `<div class="note">Note: ${esc(it.note)}</div>` : ""}
          ${it.photo_base64 ? `<img class="photo" src="data:image/jpeg;base64,${it.photo_base64}" />` : ""}
        </td>
        <td class="qscore">${scoreLabel(it)}</td>
        <td class="qresp" style="color:${resp.color}">${resp.label}</td>
      </tr>`;
    }).join("");

    return `
    <div class="section-block">
      <table class="section-header-table">
        <tr><td class="section-name">${esc(sec.name).toUpperCase()}</td><td class="section-score">(${stat.actual.toFixed(0)}/${stat.target.toFixed(0)}) ${stat.pct.toFixed(1)} %</td></tr>
      </table>
      <table class="items-table">
        <thead>
          <tr><th class="qnum">Q#</th><th>Question</th><th class="qscore">Score</th><th class="qresp">Response</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 0; padding: 32px; }
  .header-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .header-table td { vertical-align: top; }
  .hotel-name { font-size: 26px; font-weight: bold; color: #1a2744; letter-spacing: 0.5px; }
  .template-name { font-size: 15px; font-weight: bold; color: #b03030; letter-spacing: 1px; margin-top: 4px; text-transform: uppercase; }
  .logo { width: 64px; height: 64px; float: right; border-radius: 6px; }
  .divider { border: none; border-top: 3px solid #1a2744; margin: 8px 0 20px; }
  .meta-line { text-align: center; font-size: 12px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 18px; }
  .score-block { text-align: center; margin-bottom: 24px; }
  .score-date { font-size: 13px; color: #444; }
  .score-date b { color: #1a2744; }
  .score-pct { font-size: 46px; font-weight: bold; color: ${scoreColor}; margin: 4px 0; }
  .score-frac { font-size: 14px; color: #888; }

  .band-title { background: #d9d9d9; font-size: 12px; font-weight: bold; letter-spacing: 2px; color: #1a2744; padding: 6px 10px; margin: 22px 0 0; text-transform: uppercase; }
  .band-body { border: 1px solid #d9d9d9; border-top: none; padding: 10px; font-size: 13px; }

  .bar-row { margin: 10px 0; }
  .bar-label { font-size: 12px; color: #444; margin-bottom: 2px; }
  .bar-track { position: relative; background: #eee; border-radius: 3px; height: 22px; }
  .bar-fill { position: absolute; top: 0; left: 0; height: 100%; background: #6b6f7b; border-radius: 3px; }
  .bar-value { position: relative; left: 8px; line-height: 22px; font-size: 11px; color: #1a2744; font-weight: bold; }

  .section-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  .section-table th, .section-table td { border: 1px solid #d9d9d9; padding: 5px 8px; text-align: left; }
  .section-table th { background: #f2f2f2; }

  .section-block { margin-top: 22px; page-break-inside: avoid; }
  .section-header-table { width: 100%; border-collapse: collapse; }
  .section-header-table td { background: #d9d9d9; font-size: 13px; font-weight: bold; color: #1a2744; padding: 6px 10px; }
  .section-score { text-align: right; }
  .items-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .items-table th { border-bottom: 2px solid #1a2744; padding: 6px 8px; text-align: left; font-size: 11px; color: #1a2744; }
  .qrow td { border-bottom: 1px solid #eee; padding: 8px; vertical-align: top; }
  .qnum { width: 28px; }
  .qscore { width: 55px; white-space: nowrap; }
  .qresp { width: 70px; font-weight: bold; white-space: nowrap; }
  .note { font-size: 11px; font-style: italic; color: #666; margin-top: 4px; }
  .photo { display: block; margin-top: 6px; max-width: 200px; border-radius: 6px; border: 1px solid #ddd; }

  .summary-box { font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
  .declaration { margin-top: 32px; page-break-inside: avoid; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 40px; }
  .sign-box { width: 45%; }
  .sign-line { border-top: 1px solid #444; margin-top: 40px; padding-top: 4px; font-size: 12px; color: #444; }

  .footer { margin-top: 32px; border-top: 1px solid #e5e5e5; padding-top: 10px; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td>
        <div class="hotel-name">CITY PARK HOTEL</div>
        <div class="template-name">${esc(audit.template_name)}</div>
      </td>
      <td style="width:70px">
        <img class="logo" src="data:image/png;base64,${PDF_LOGO_BASE64}" />
      </td>
    </tr>
  </table>
  <hr class="divider" />

  ${audit.location ? `<div class="meta-line">${esc(audit.location)}</div>` : ""}

  <div class="score-block">
    <div class="score-date">${esc(completedDate)}</div>
    <div class="score-pct">${scorePct != null ? scorePct.toFixed(1) : "—"} %</div>
    <div class="score-frac">(${totalActual.toFixed(1)} / ${totalTarget.toFixed(1)})</div>
  </div>

  <div class="band-title">Summary</div>
  <div class="band-body">${esc(audit.location || "")} ${esc(audit.auditor_name)}</div>

  <div class="band-title">Score By Section</div>
  <div class="band-body">
    ${barsHtml}
    <table class="section-table">
      <tr><th>Section</th><th>Actual</th><th>Target</th><th>%</th></tr>
      ${sectionTableRows}
    </table>
  </div>

  ${audit.ai_summary ? `<div class="band-title">AI Report Summary</div><div class="band-body summary-box">${esc(audit.ai_summary)}</div>` : ""}

  ${sectionsHtml}

  <div class="declaration">
    <div class="band-title">Declaration</div>
    <div class="band-body">
      I declare that this audit was carried out accurately and to the best of my knowledge, and that all
      failed checks have supporting photo evidence attached.
    </div>
    <div class="sign-row">
      <div class="sign-box">
        <div class="sign-line">Auditor — ${esc(audit.auditor_name.toUpperCase())}</div>
      </div>
      <div class="sign-box">
        <div class="sign-line">Date</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>CityPark Audit</span>
    <span>Generated ${esc(new Date().toLocaleString())}</span>
  </div>
</body>
</html>`;
}

export async function exportAuditPdf(audit: Audit): Promise<void> {
  const html = buildAuditHtml(audit);
  if (Platform.OS === "web") {
    // expo-print's web implementation ignores the `html` option entirely and just
    // calls window.print() on whatever page is currently open - it never renders
    // our report. Render it ourselves in a new window and print/"Save as PDF" that.
    const printHtml = html.replace(
      "</body>",
      `<script>window.onload = function () { setTimeout(function () { window.print(); }, 50); };</script></body>`
    );
    const win = window.open("", "_blank");
    if (!win) {
      throw new Error("Please allow pop-ups for this site to export the PDF");
    }
    win.document.open();
    win.document.write(printHtml);
    win.document.close();
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share Audit Report" });
  }
}
