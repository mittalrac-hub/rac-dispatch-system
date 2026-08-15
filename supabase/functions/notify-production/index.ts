// RAC Extrusions — Production scan WhatsApp notification Edge Function
// When a supervisor scans a production report, this generates a PDF summary
// and sends it via WhatsApp to all users flagged for notifications (in-charges).
//
// Request  (POST JSON): { rows: [...], date, shift, press, supervisor, operator, pin }
// Response (JSON):      { sent: N, errors: [...] }
//
// Supabase secrets required:
//   WA_PHONE_NUMBER_ID  — HelloAll / Meta phone number ID (e.g. 758857277311943)
//   WA_ACCESS_TOKEN     — HelloAll API bearer token
//
// Users table must have:  phone TEXT, notify_scan BOOLEAN DEFAULT false
// Set notify_scan = true and phone = '91XXXXXXXXXX' for each in-charge user.

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WA_PHONE_ID  = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const WA_TOKEN     = Deno.env.get("WA_ACCESS_TOKEN") ?? "";
const WA_API       = "https://crm.helloall.in/api/meta/v19.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function rest(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`rest ${path}: ${r.status}`);
  return r.json();
}

// ── PDF generation using pdf-lib ─────────────────────────────────────────────

interface ProdRow {
  section_no?: string;
  casting_no?: string;
  alloy?: string;
  cavity?: string;
  cut_length?: string;
  wt_pc?: string;
  produced_pcs?: string;
  billet_size?: string;
  num_billets?: string;
  input_kg?: string;
  output_kg?: string;
  die_load?: string;
  die_unload?: string;
  customer?: string;
  remarks?: string;
}

interface Header {
  date: string;
  shift: string;
  press: string;
  supervisor: string;
  operator: string;
}

const COLS: { label: string; key: keyof ProdRow; w: number; align: "l" | "r" }[] = [
  { label: "#",        key: "section_no",   w: 22,  align: "l" },
  { label: "Section",  key: "section_no",   w: 52,  align: "l" },
  { label: "Casting",  key: "casting_no",   w: 48,  align: "l" },
  { label: "Alloy",    key: "alloy",        w: 38,  align: "l" },
  { label: "Cav",      key: "cavity",       w: 28,  align: "r" },
  { label: "Cut Len",  key: "cut_length",   w: 42,  align: "l" },
  { label: "Wt/Pc",    key: "wt_pc",        w: 42,  align: "r" },
  { label: "Pcs",      key: "produced_pcs", w: 35,  align: "r" },
  { label: "Billet",   key: "billet_size",   w: 42,  align: "r" },
  { label: "NoBlt",    key: "num_billets",  w: 35,  align: "r" },
  { label: "Input kg", key: "input_kg",     w: 50,  align: "r" },
  { label: "Output kg",key: "output_kg",    w: 55,  align: "r" },
  { label: "Die In",   key: "die_load",     w: 40,  align: "l" },
  { label: "Die Out",  key: "die_unload",   w: 40,  align: "l" },
  { label: "Customer", key: "customer",     w: 72,  align: "l" },
];

async function buildPDF(rows: ProdRow[], hdr: Header): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A4 landscape
  const pageW = 841.89;
  const pageH = 595.28;
  const marginL = 30;
  const marginR = 30;
  const marginT = 40;
  const marginB = 30;

  const page = doc.addPage([pageW, pageH]);
  let y = pageH - marginT;

  // ── Title ──
  const title = "RAC Extrusions — Production Report";
  page.drawText(title, {
    x: marginL, y, size: 14, font: fontBold,
    color: rgb(0.12, 0.27, 0.13),
  });
  y -= 18;

  // ── Header line ──
  const hdrText = `Date: ${hdr.date}   |   Shift: ${hdr.shift}   |   Press: ${hdr.press}   |   Supervisor: ${hdr.supervisor}   |   Operator: ${hdr.operator}`;
  page.drawText(hdrText, {
    x: marginL, y, size: 8.5, font,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 6;

  // ── Separator line ──
  y -= 6;
  page.drawLine({
    start: { x: marginL, y },
    end: { x: pageW - marginR, y },
    thickness: 1,
    color: rgb(0.12, 0.27, 0.13),
  });
  y -= 14;

  // ── Table header ──
  const rowH = 16;
  const fontSize = 7.5;
  const hdrFontSize = 7;
  let x = marginL;

  // Header background
  page.drawRectangle({
    x: marginL, y: y - 3, width: pageW - marginL - marginR, height: rowH,
    color: rgb(0.12, 0.27, 0.13),
  });

  // # column header
  page.drawText("#", {
    x: marginL + 2, y: y, size: hdrFontSize, font: fontBold,
    color: rgb(1, 1, 1),
  });
  x = marginL + COLS[0].w;

  // Rest of headers (skip index 0 which is the # column we already drew)
  for (let i = 1; i < COLS.length; i++) {
    const col = COLS[i];
    page.drawText(col.label, {
      x: x + 2, y, size: hdrFontSize, font: fontBold,
      color: rgb(1, 1, 1),
    });
    x += col.w;
  }
  y -= rowH;

  // ── Data rows ──
  let totalPcs = 0;
  let totalOut = 0;
  let totalIn = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];

    // Check if we need a new page
    if (y < marginB + 30) {
      const newPage = doc.addPage([pageW, pageH]);
      y = pageH - marginT;
      // Redraw header on new page
      x = marginL;
      newPage.drawRectangle({
        x: marginL, y: y - 3, width: pageW - marginL - marginR, height: rowH,
        color: rgb(0.12, 0.27, 0.13),
      });
      newPage.drawText("#", {
        x: marginL + 2, y, size: hdrFontSize, font: fontBold,
        color: rgb(1, 1, 1),
      });
      x = marginL + COLS[0].w;
      for (let i = 1; i < COLS.length; i++) {
        newPage.drawText(COLS[i].label, {
          x: x + 2, y, size: hdrFontSize, font: fontBold,
          color: rgb(1, 1, 1),
        });
        x += COLS[i].w;
      }
      y -= rowH;
    }

    // Alternate row background
    const currentPage = doc.getPages()[doc.getPageCount() - 1];
    if (ri % 2 === 0) {
      currentPage.drawRectangle({
        x: marginL, y: y - 3,
        width: pageW - marginL - marginR, height: rowH,
        color: rgb(0.94, 0.97, 0.94),
      });
    }

    // Row number
    x = marginL;
    currentPage.drawText(String(ri + 1), {
      x: x + 2, y, size: fontSize, font,
      color: rgb(0.2, 0.2, 0.2),
    });
    x += COLS[0].w;

    // Data cells
    for (let i = 1; i < COLS.length; i++) {
      const col = COLS[i];
      let val = String(row[col.key] ?? "");
      // Truncate long values
      if (val.length > 12) val = val.substring(0, 11) + "…";
      const tw = font.widthOfTextAtSize(val, fontSize);
      const cx = col.align === "r" ? x + col.w - tw - 3 : x + 2;
      currentPage.drawText(val, {
        x: cx, y, size: fontSize, font,
        color: rgb(0.1, 0.1, 0.1),
      });
      x += col.w;
    }

    // Accumulate totals
    const pcs = parseFloat(String(row.produced_pcs ?? "0")) || 0;
    const outK = parseFloat(String(row.output_kg ?? "0")) || 0;
    const inK = parseFloat(String(row.input_kg ?? "0")) || 0;
    totalPcs += pcs;
    totalOut += outK;
    totalIn += inK;

    y -= rowH;
  }

  // ── Totals row ──
  const lastPage = doc.getPages()[doc.getPageCount() - 1];
  y -= 4;
  lastPage.drawLine({
    start: { x: marginL, y: y + 10 },
    end: { x: pageW - marginR, y: y + 10 },
    thickness: 1,
    color: rgb(0.12, 0.27, 0.13),
  });

  const totText = `Total:  ${rows.length} lines   |   ${totalPcs} pcs   |   Input: ${Math.round(totalIn)} kg   |   Output: ${Math.round(totalOut)} kg`;
  lastPage.drawText(totText, {
    x: marginL, y, size: 9, font: fontBold,
    color: rgb(0.12, 0.27, 0.13),
  });
  y -= 16;

  // ── Recovery % ──
  if (totalIn > 0) {
    const recPct = ((totalOut / totalIn) * 100).toFixed(1);
    lastPage.drawText(`Recovery: ${recPct}%`, {
      x: marginL, y, size: 8.5, font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 14;
  }

  // ── Footer ──
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  lastPage.drawText(`Generated ${ts}  —  RAC Extrusions Ltd`, {
    x: marginL, y: marginB, size: 7, font,
    color: rgb(0.6, 0.6, 0.6),
  });

  return doc.save();
}

// ── WhatsApp send ────────────────────────────────────────────────────────────

async function uploadMedia(pdfBytes: Uint8Array, filename: string): Promise<{ id?: string; error?: string }> {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", blob, filename);

  const url = `${WA_API}/${WA_PHONE_ID}/media`;
  console.log("Media upload →", url, "file size:", pdfBytes.length);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
      body: form,
    });
  } catch (e) {
    const msg = `Media upload fetch error: ${String(e)}`;
    console.error(msg);
    return { error: msg };
  }

  const text = await resp.text();
  console.log(`Media upload response (HTTP ${resp.status}):`, text);
  if (resp.ok) {
    try {
      const data = JSON.parse(text);
      if (data.id) return { id: data.id };
    } catch { /* fall through */ }
    return { error: `Unexpected response: ${text}` };
  }
  return { error: `HTTP ${resp.status}: ${text}` };
}

interface SendOpts {
  date: string; shift: string; press: string;
  supervisor: string; lineCount: number; totalKg: number;
}

async function sendWhatsApp(
  phone: string, mediaId: string, filename: string, opts: SendOpts,
): Promise<boolean> {
  // Uses approved template "production_report" — works anytime, no 24h window needed.
  // Template body vars: {{1}}=date, {{2}}=shift, {{3}}=press, {{4}}=supervisor, {{5}}=lines, {{6}}=output kg
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template: {
      language: { policy: "deterministic", code: "en" },
      name: "production_report",
      components: [
        {
          type: "header",
          parameters: [{
            type: "document",
            document: { id: mediaId, filename },
          }],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: opts.date },
            { type: "text", text: opts.shift },
            { type: "text", text: opts.press },
            { type: "text", text: opts.supervisor },
            { type: "text", text: String(opts.lineCount) },
            { type: "text", text: String(opts.totalKg) },
          ],
        },
      ],
    },
  };

  const resp = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  if (resp.ok) {
    console.log(`WhatsApp sent → ${phone}: ${text}`);
    return true;
  }
  console.error(`WhatsApp failed → ${phone} (HTTP ${resp.status}): ${text}`);
  return false;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad JSON body" }, 400);
  }

  const { rows, date, shift, press, supervisor, operator, pin } = body ?? {};
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return json({ error: "rows required" }, 400);
  }
  if (!pin) return json({ error: "pin required" }, 400);

  // Verify PIN
  try {
    const u = await rest(
      `users?select=pin&pin=eq.${encodeURIComponent(String(pin))}&limit=1`,
    );
    if (!Array.isArray(u) || u.length === 0) {
      return json({ error: "invalid PIN" }, 403);
    }
  } catch (e) {
    return json({ error: "PIN check failed: " + String(e) }, 500);
  }

  // Check WA credentials
  if (!WA_PHONE_ID || !WA_TOKEN) {
    return json({ error: "WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN not configured" }, 500);
  }

  // Get all users to notify (notify_scan = true, phone not null)
  let recipients: Array<{ name: string; phone: string }> = [];
  try {
    recipients = await rest(
      "users?select=name,phone&notify_scan=eq.true&phone=not.is.null",
    );
    if (!Array.isArray(recipients)) recipients = [];
    // Filter out empty phones
    recipients = recipients.filter(
      (r: any) => r.phone && String(r.phone).replace(/\D/g, "").length >= 10,
    );
  } catch (e) {
    console.error("Failed to query notification recipients:", e);
    return json({ error: "Could not query recipients: " + String(e) }, 500);
  }

  if (recipients.length === 0) {
    return json({ sent: 0, message: "No recipients configured (set notify_scan=true and phone on user records)" });
  }

  // Generate PDF
  const hdr: Header = {
    date: date || new Date().toISOString().slice(0, 10),
    shift: shift || "",
    press: press || "",
    supervisor: supervisor || "",
    operator: operator || "",
  };

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildPDF(rows, hdr);
  } catch (e) {
    console.error("PDF generation failed:", e);
    return json({ error: "PDF generation failed: " + String(e) }, 500);
  }

  // Upload PDF to WhatsApp media
  const filename = `Production_${(press || "").replace(/\s/g, "")}_${(shift || "")}_${(date || "").replace(/\//g, "-")}.pdf`;
  const media = await uploadMedia(pdfBytes, filename);
  if (!media.id) {
    return json({ error: "WhatsApp media upload failed", detail: media.error }, 502);
  }
  const mediaId = media.id;

  // Build template params
  const totalPcs = rows.reduce((s: number, r: any) => s + (parseFloat(r.produced_pcs) || 0), 0);
  const totalOut = rows.reduce((s: number, r: any) => s + (parseFloat(r.output_kg) || 0), 0);
  const sendOpts: SendOpts = {
    date: hdr.date, shift: hdr.shift, press: hdr.press,
    supervisor: hdr.supervisor, lineCount: rows.length, totalKg: Math.round(totalOut),
  };

  // Send to each recipient
  const errors: string[] = [];
  let sent = 0;

  for (const recip of recipients) {
    const phone = String(recip.phone).replace(/\D/g, "");
    try {
      const ok = await sendWhatsApp(phone, mediaId, filename, sendOpts);
      if (ok) sent++;
      else errors.push(`${recip.name}: send failed`);
    } catch (e) {
      errors.push(`${recip.name}: ${String(e)}`);
    }
  }

  return json({ sent, total: recipients.length, errors });
});
