import TRIAGE_PROMPT from '../prompts/triage.js';
import HAIKU_PROMPT from '../prompts/haiku.js';
import SONNET_PROMPT from '../prompts/sonnet.js';

const FREE_PROMPT = `You are an analysis system for UK parking fines.

Your task:
Read the document and provide a short, free initial assessment.

Focus: Are there grounds to challenge or appeal this parking fine?

Always return your answer in exactly this structure:

[ISSUER]
Name of the issuer (company or council)
[/ISSUER]

[ISSUER_TYPE]
Type: Private Company, Council, or Police
[/ISSUER_TYPE]

[FINE_AMOUNT]
Fine amount as a number (number only, no currency symbol)
[/FINE_AMOUNT]

[RISK]
low or medium or high
[/RISK]

[TEASER]
Write exactly 1 sentence: state ONLY that there may be grounds to challenge this fine.
Do NOT mention specific reasons or amounts.
[/TEASER]`;

// ── Claude API ────────────────────────────────────────────────────────────────

async function callClaudeDocument(env, { model, maxTokens, prompt, fileBase64, mediaType }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          mediaType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
            : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API error: ${JSON.stringify(data)}`);
  return data?.content?.[0]?.text || "";
}

// ── Utils ─────────────────────────────────────────────────────────────────────

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mediaType: file.type || "application/pdf" };
}

function safeJsonParse(str) {
  try { return JSON.parse(String(str).trim()); }
  catch {
    try {
      const match = String(str).match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch { return null; }
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
const MAX_FILE_SIZE = 8 * 1024 * 1024;

function validateUploadInput({ file, name, email }) {
  if (!file) return "No file received";
  if (file.size > MAX_FILE_SIZE) return "File too large (max 8 MB)";
  if (!ALLOWED_TYPES.includes(file.type)) return "File type not allowed. Please use PDF, JPG or PNG.";
  if (!name || !String(name).trim()) return "Name is required";
  if (!email || !String(email).includes("@") || !String(email).includes(".")) return "Invalid email address";
  return null;
}

function extractTaggedSection(text, tag) {
  const start = `[${tag}]`;
  const end = `[/${tag}]`;
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return "";
  return text.substring(si + start.length, ei).trim();
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

// ── RTF ───────────────────────────────────────────────────────────────────────

function rtfEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}")
    .replace(/\n/g, "\\par\n")
    .replace(/[^\x00-\x7F]/g, c => `\\u${c.charCodeAt(0)}?`);
}

function rtfToBase64(rtfString) {
  const bytes = new TextEncoder().encode(rtfString);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bulletLines(text) {
  return String(text || "").split("\n").map(l => l.trim()).filter(Boolean)
    .map(l => `{\\pard\\sb0\\sa200\\fi-300\\li300\\f1\\fs22 \\bullet  ${rtfEscape(l.replace(/^- /, ""))}\\par}`)
    .join("\n");
}

function makeAnalysisRtf(analysis, customerName, customerEmail, triage) {
  const fineAmount = triage?.fine_amount ? `\\u163?${triage.fine_amount}` : "unknown";
  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22
{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${rtfEscape(extractTaggedSection(analysis, "TITLE") || "Parking Fine Appeal")}\\par}
{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 Name: ${rtfEscape(customerName || "")} (${rtfEscape(customerEmail || "")})\\par}
{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Issuer: ${rtfEscape(triage?.issuer || "unknown")} | Type: ${rtfEscape(triage?.issuer_type || "unknown")} | Amount: ${fineAmount} | Risk: ${rtfEscape(triage?.risk || "")}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Summary\\par}
{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "SUMMARY"))}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Grounds for Appeal\\par}
${bulletLines(extractTaggedSection(analysis, "ISSUES"))}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Assessment\\par}
{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "ASSESSMENT"))}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Next Steps\\par}
${bulletLines(extractTaggedSection(analysis, "NEXT_STEPS"))}
{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i Note: This is an informational analysis and not legal advice. ParkingFine is not liable for the outcome of your appeal.\\par}
}`;
}

function makeAppealLetterRtf(analysis, customerName, triage) {
  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22
{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf2 Parking Fine Appeal Letter\\par}
{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Prepared for: ${rtfEscape(customerName || "")} | Issuer: ${rtfEscape(triage?.issuer || "unknown")}\\par}
{\\pard\\sb300\\sa200\\f1\\fs22\\cf0 ${rtfEscape(extractTaggedSection(analysis, "OBJECTION"))}\\par}
{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i Note: This is a draft appeal letter and not legal advice.\\par}
}`;
}

function makeAdminRtf(analysis, customerName, customerEmail, triage) {
  const fineAmount = triage?.fine_amount ? `\\u163?${triage.fine_amount}` : "unknown";
  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22
{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${rtfEscape(extractTaggedSection(analysis, "TITLE") || "Parking Fine Appeal")}\\par}
{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 Name: ${rtfEscape(customerName || "")} (${rtfEscape(customerEmail || "")})\\par}
{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Issuer: ${rtfEscape(triage?.issuer || "unknown")} | Type: ${rtfEscape(triage?.issuer_type || "unknown")} | Amount: ${fineAmount} | Risk: ${rtfEscape(triage?.risk || "")}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Summary\\par}
{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "SUMMARY"))}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Grounds for Appeal\\par}
${bulletLines(extractTaggedSection(analysis, "ISSUES"))}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Assessment\\par}
{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "ASSESSMENT"))}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Next Steps\\par}
${bulletLines(extractTaggedSection(analysis, "NEXT_STEPS"))}
{\\pard\\sa200\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b\\cf2 Appeal Letter\\par}
{\\pard\\sa200\\f1\\fs22\\cf0 ${rtfEscape(extractTaggedSection(analysis, "OBJECTION"))}\\par}
{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i Note: Informational analysis, not legal advice.\\par}
}`;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleTriage(env, fileBase64, mediaType) {
  const raw = await callClaudeDocument(env, {
    model: "claude-haiku-4-5-20251001", maxTokens: 800,
    prompt: TRIAGE_PROMPT, fileBase64, mediaType
  });
  console.log("TRIAGE RAW:", raw.substring(0, 300));
  const p = safeJsonParse(raw);
  console.log("TRIAGE RESULT:", JSON.stringify(p));
  if (!p) return { issuer: null, issuer_type: null, fine_amount: null, reduced_amount: null, contravention: null, issue_date: null, is_ntk: null, risk: "medium", route: "SONNET" };
  return {
    issuer: p.issuer || null,
    issuer_type: p.issuer_type || null,
    fine_amount: typeof p.fine_amount === "number" ? p.fine_amount : null,
    reduced_amount: typeof p.reduced_amount === "number" ? p.reduced_amount : null,
    contravention: p.contravention || null,
    issue_date: p.issue_date || null,
    payment_deadline: p.payment_deadline || null,
    is_ntk: p.is_ntk ?? null,
    risk: p.risk || "medium",
    route: p.route || "SONNET"
  };
}

async function handleFreeAnalysis(env, fileBase64, mediaType) {
  const raw = await callClaudeDocument(env, {
    model: "claude-haiku-4-5-20251001", maxTokens: 600,
    prompt: FREE_PROMPT, fileBase64, mediaType
  });
  console.log("FREE RAW:", raw.substring(0, 300));
  return {
    issuer: extractTaggedSection(raw, "ISSUER") || null,
    issuer_type: extractTaggedSection(raw, "ISSUER_TYPE") || null,
    fine_amount: parseFloat(extractTaggedSection(raw, "FINE_AMOUNT")) || null,
    risk: extractTaggedSection(raw, "RISK") || "medium",
    teaser: extractTaggedSection(raw, "TEASER") || null
  };
}

async function generateAnalysis(env, { fileBase64, mediaType, route }) {
  const useSonnet = route === "SONNET";
  const analysis = await callClaudeDocument(env, {
    model: useSonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
    maxTokens: useSonnet ? 3500 : 1800,
    prompt: useSonnet ? SONNET_PROMPT : HAIKU_PROMPT,
    fileBase64, mediaType
  }) || "";
  console.log("ANALYSIS MODEL:", useSonnet ? "sonnet" : "haiku");
  console.log("ANALYSIS LENGTH:", analysis.length);
  console.log("ANALYSIS TAGS:", ["TITLE","SUMMARY","ISSUES","ASSESSMENT","NEXT_STEPS","OBJECTION"].map(t => `${t}:${extractTaggedSection(analysis,t).length > 0 ? "OK" : "MISSING"}`).join(" "));
  return analysis;
}

// ── Mail helpers ──────────────────────────────────────────────────────────────

function buildFreeMailHtml({ name, issuer, issuer_type, fine_amount, risk, teaser, stripeLink }) {
  const riskLabel = { low: "Low", medium: "Medium", high: "High" }[risk] || risk;
  const amount = fine_amount ? `\u00A3${fine_amount}` : "unknown";
  const isPrivate = String(issuer_type || "").toLowerCase().includes("private");
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Your free parking fine assessment</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>We've checked your parking fine for potential grounds to appeal.</p>
      ${isPrivate ? `<p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:4px;"><strong>Good news:</strong> This appears to be a private parking charge, not a council PCN. Private fines are much easier to challenge and are not directly enforceable by bailiffs.</p>` : ""}
      <table style="width:100%;border-collapse:collapse;margin:24px 0;">
        <tr style="background:#f3f4f6;"><td style="padding:10px 14px;font-weight:bold;">Issued by</td><td style="padding:10px 14px;">${escapeHtml(issuer || "unknown")}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:bold;">Type</td><td style="padding:10px 14px;">${escapeHtml(issuer_type || "unknown")}</td></tr>
        <tr style="background:#f3f4f6;"><td style="padding:10px 14px;font-weight:bold;">Fine amount</td><td style="padding:10px 14px;font-weight:bold;color:#1d3a6e;">${amount}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:bold;">Appeal potential</td><td style="padding:10px 14px;">${riskLabel}</td></tr>
      </table>
      <p style="background:#fef9c3;border-left:4px solid #eab308;padding:12px 16px;border-radius:4px;">${escapeHtml(teaser || "Based on your fine, there may be grounds to appeal.")}</p>
      <p>For a full analysis and ready-to-send appeal letter:</p>
      <a href="${stripeLink}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:8px 0;">
        Get my full appeal letter &mdash; &pound;19 &rarr;
      </a>
      <p style="color:#6b7280;font-size:0.85rem;margin-top:24px;">This is an informational assessment, not legal advice.</p>
    </div>
  `;
}

// ── Mailers ───────────────────────────────────────────────────────────────────

async function sendAdminFreeNotification(env, { name, email, free, stripeLink }) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ParkingFine <noreply@parkingfine.co.uk>",
      to: [env.ADMIN_EMAIL],
      reply_to: [email],
      subject: `New free check: ${name} (${email})`,
      html: `<p style="background:#f3f4f6;padding:10px 14px;border-radius:6px;font-size:0.85rem;color:#6b7280;">📬 Customer email will be sent tomorrow at 15:00 to <strong>${escapeHtml(email)}</strong></p>
      ${buildFreeMailHtml({ name, ...free, stripeLink })}`
    })
  });
}

async function sendAdminPaidNotification(env, { customerName, customerEmail, triage, analysis }) {
  const rtfContent = makeAdminRtf(analysis, customerName, customerEmail, triage);
  const isPrivate = triage?.issuer_type === "private";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ParkingFine <noreply@parkingfine.co.uk>",
      to: [env.ADMIN_EMAIL],
      reply_to: [customerEmail],
      subject: `New paid appeal: ${customerName} (${customerEmail})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;">
        <p style="background:#f3f4f6;padding:10px 14px;border-radius:6px;font-size:0.85rem;color:#6b7280;">📬 Customer email (2 attachments) tomorrow at 15:00 to <strong>${escapeHtml(customerEmail)}</strong></p>
        <h2>New parking fine appeal</h2>
        <p><strong>Name:</strong> ${escapeHtml(customerName || "")}</p>
        <p><strong>Issuer:</strong> ${escapeHtml(triage?.issuer || "unknown")}</p>
        <p><strong>Type:</strong> ${escapeHtml(triage?.issuer_type || "unknown")}${isPrivate ? " <span style='color:green'>(PRIVATE — easier to win)</span>" : ""}</p>
        <p><strong>Amount:</strong> ${triage?.fine_amount ? `\u00A3${triage.fine_amount}` : "unknown"}</p>
        <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
      </div>`,
      attachments: [{ filename: "ParkingFine-Analysis.rtf", content: rtfToBase64(rtfContent) }]
    })
  });
}

async function sendDelayedFreeEmail(env, entry) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ParkingFine <noreply@parkingfine.co.uk>",
      to: [entry.email],
      subject: "Your free parking fine assessment — ParkingFine.co.uk",
      html: buildFreeMailHtml({
        name: entry.name,
        issuer: entry.issuer,
        issuer_type: entry.issuer_type,
        fine_amount: entry.fine_amount,
        risk: entry.risk,
        teaser: entry.teaser,
        stripeLink: entry.stripe_link || "https://parkingfine.co.uk"
      })
    })
  });
}

async function sendDelayedPaidEmail(env, entry) {
  const analysisRtf = makeAnalysisRtf(entry.analysis, entry.name, entry.email, entry.triage);
  const appealRtf = makeAppealLetterRtf(entry.analysis, entry.name, entry.triage);
  const isPrivate = entry.triage?.issuer_type === "private";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ParkingFine <noreply@parkingfine.co.uk>",
      to: [entry.email],
      subject: "Your parking fine appeal letter is ready — ParkingFine.co.uk",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
        <h2 style="color:#1d3a6e;">Your appeal letter is ready</h2>
        <p>Hi ${escapeHtml(entry.name)},</p>
        <p>Two files are attached:</p>
        <ul style="line-height:1.9;">
          <li><strong>ParkingFine-Analysis.rtf</strong> &mdash; full assessment with grounds for appeal and next steps</li>
          <li><strong>Appeal-Letter.rtf</strong> &mdash; ready-to-send appeal letter</li>
        </ul>
        ${entry.triage?.issuer ? `<p>Issued by: <strong>${escapeHtml(entry.triage.issuer)}</strong></p>` : ""}
        ${entry.triage?.fine_amount ? `<p>Fine amount: <strong>\u00A3${entry.triage.fine_amount}</strong></p>` : ""}
        ${isPrivate ? `<p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:4px;font-size:0.9rem;">
          <strong>Private parking charge:</strong> This is NOT a council PCN and is not directly enforceable by bailiffs. Many private appeals succeed. Send your appeal letter and do not ignore it.
        </p>` : `<p style="background:#fff7ed;border-left:4px solid #f97316;padding:12px 16px;border-radius:4px;font-size:0.9rem;">
          <strong>Council PCN:</strong> Send your appeal promptly. If rejected at the informal stage, you have a new 14-day discount window and can escalate to the independent adjudicator.
        </p>`}
        <p style="color:#6b7280;font-size:0.85rem;margin-top:32px;">This is an informational analysis and not legal advice.</p>
      </div>`,
      attachments: [
        { filename: "ParkingFine-Analysis.rtf", content: rtfToBase64(analysisRtf) },
        { filename: "Appeal-Letter.rtf", content: rtfToBase64(appealRtf) }
      ]
    })
  });
}

// ── Cron ──────────────────────────────────────────────────────────────────────

async function handleCron(env) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const list = await env.PARKING_QUEUE.list();
  for (const key of list.keys) {
    try {
      const raw = await env.PARKING_QUEUE.get(key.name);
      if (!raw) continue;
      const entry = JSON.parse(raw);
      if (now - new Date(entry.created_at).getTime() < oneDayMs) continue;
      if (entry.type === "free") await sendDelayedFreeEmail(env, entry);
      else await sendDelayedPaidEmail(env, entry);
      await env.PARKING_QUEUE.delete(key.name);
    } catch (err) {
      console.error(`Cron error for ${key.name}:`, err.message);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/analyze") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file) return jsonResponse({ ok: false, error: "No file received" }, 400);
        const { base64, mediaType } = await fileToBase64(file);
        const triage = await handleTriage(env, base64, mediaType);
        return jsonResponse({ ok: true, ...triage });
      } catch (err) { return jsonResponse({ ok: false, error: err.message }, 500); }
    }

    if (request.method === "POST" && url.pathname === "/analyze-free") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const name = formData.get("name");
        const email = formData.get("email");
        const stripeLink = env.STRIPE_LINK || "https://parkingfine.co.uk";
        const err = validateUploadInput({ file, name, email });
        if (err) return jsonResponse({ ok: false, error: err }, 400);
        const { base64, mediaType } = await fileToBase64(file);
        const free = await handleFreeAnalysis(env, base64, mediaType);
        await env.PARKING_QUEUE.put(`free:${Date.now()}:${email}`, JSON.stringify({
          type: "free", name, email,
          issuer: free.issuer || "", issuer_type: free.issuer_type || "",
          fine_amount: free.fine_amount || null, risk: free.risk || "medium",
          teaser: free.teaser || "", stripe_link: stripeLink,
          created_at: new Date().toISOString()
        }));
        try { await sendAdminFreeNotification(env, { name, email, free, stripeLink }); } catch (_) {}
        return jsonResponse({ ok: true, message: "You'll receive your assessment by the next business day before 4pm." });
      } catch (err) { return jsonResponse({ ok: false, error: err.message }, 500); }
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const name = formData.get("name");
        const email = formData.get("email");
        const err = validateUploadInput({ file, name, email });
        if (err) return jsonResponse({ ok: false, error: err }, 400);
        const { base64, mediaType } = await fileToBase64(file);
        const triage = await handleTriage(env, base64, mediaType);
        const analysis = await generateAnalysis(env, { fileBase64: base64, mediaType, route: triage.route });
        await env.PARKING_QUEUE.put(`paid:${Date.now()}:${email}`, JSON.stringify({
          type: "paid", name, email, analysis, triage, created_at: new Date().toISOString()
        }));
        await sendAdminPaidNotification(env, { customerName: name, customerEmail: email, triage, analysis });
        return jsonResponse({ ok: true, message: "Upload successful. You'll receive your appeal letter by the next business day before 4pm." });
      } catch (err) { return jsonResponse({ ok: false, error: err.message }, 500); }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  }
};
