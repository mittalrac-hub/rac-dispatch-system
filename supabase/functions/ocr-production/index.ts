// RAC Extrusions — OCR production-report Edge Function
// One handwritten daily report image -> Claude Opus 4.8 vision -> structured rows.
// The ANTHROPIC_API_KEY secret is read at runtime and NEVER sent to the browser.
//
// Request  (POST JSON): { image_base64: string, media_type?: string, pin: string }
// Response (JSON):      { rows: [...], header: {...}, count: N, usage: {...} }
//
// Notes:
// - Transcription only. Rows land in the app's review grid; the user corrects
//   before import. No DB writes happen here.
// - A valid app PIN is required so the public anon key can't be used to drain
//   API credits.
// - Adaptive thinking is ON, effort is MEDIUM. History: effort was raised low->high
//   on 10 Aug 2026 for accuracy, but that made runtime bimodal — most images
//   finished in 11-32s while some exceeded Supabase's hard 150s Edge Function
//   wall-clock limit and returned HTTP 546. Medium keeps the cross-checking
//   behaviour without the timeouts. The real accuracy win was image resolution,
//   not effort. Do NOT raise this to high again without moving the call
//   off the 150s request path.
// - max_tokens is bounded at 20000 for the same reason: adaptive thinking counts
//   against it, so an unbounded budget lets a hard image run until the worker dies.
//   A 25-row sheet needs ~4k output tokens, leaving ample thinking headroom.
//   Compatible with structured output. Response has thinking blocks before the
//   text block; we pick the text block.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MODEL = "claude-opus-4-8";

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

// Strict json_schema: every object needs additionalProperties:false, and every
// listed property must be required. All fields are strings (use "" for blank);
// the client coerces numbers. This guarantees clean, parseable output.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["header", "rows"],
  properties: {
    header: {
      type: "object",
      additionalProperties: false,
      required: ["date", "shift", "press", "supervisor", "operator"],
      properties: {
        date: { type: "string" },
        shift: { type: "string" },
        press: { type: "string" },
        supervisor: { type: "string" },
        operator: { type: "string" },
      },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "casting_no", "section_no", "alloy", "cavity", "cut_length",
          "wt_pc", "produced_pcs", "billet_length_mm", "no_billets",
          "input_kg", "output_kg", "die_load", "die_unload", "customer", "remarks", "charge",
        ],
        properties: {
          casting_no: { type: "string" },
          section_no: { type: "string" },
          alloy: { type: "string" },
          cavity: { type: "string" },
          cut_length: { type: "string" },
          wt_pc: { type: "string" },
          produced_pcs: { type: "string" },
          billet_length_mm: { type: "string" },
          no_billets: { type: "string" },
          input_kg: { type: "string" },
          output_kg: { type: "string" },
          die_load: { type: "string" },
          die_unload: { type: "string" },
          customer: { type: "string" },
          remarks: { type: "string" },
          charge: { type: "string" },
        },
      },
    },
  },
};

// Feedback loop: past in-grid human corrections become few-shot hints so the
// model stops repeating the same misreads on THIS plant's handwriting.
async function buildCorrectionHints(): Promise<string> {
  let rows: any[] = [];
  try {
    rows = await rest(
      "ocr_corrections?select=field,ocr_value,corrected_value&order=id.desc&limit=1000",
    );
  } catch {
    return "";
  }
  if (!Array.isArray(rows) || !rows.length) return "";
  const counts: Record<string, number> = {};
  const meta: Record<string, { field: string; from: string; to: string }> = {};
  for (const r of rows) {
    const from = (r.ocr_value ?? "").toString().trim();
    const to = (r.corrected_value ?? "").toString().trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    const key = `${r.field}||${from}||${to}`;
    counts[key] = (counts[key] || 0) + 1;
    meta[key] = { field: r.field, from, to };
  }
  const top = Object.keys(counts)
    .filter((k) => counts[k] >= 2)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 40)
    .map(
      (k) =>
        `- ${meta[k].field}: reads like "${meta[k].from}" were actually "${meta[k].to}" (${counts[k]}x)`,
    );
  if (!top.length) return "";
  return `\n\nLEARNED CORRECTIONS (from past human fixes on this plant's handwriting — when a cell closely matches a left-hand value below, strongly prefer the right-hand value):\n${top.join("\n")}`;
}

async function rest(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`rest ${path}: ${r.status}`);
  return r.json();
}

function buildSystem(
  customers: Array<{ code: string; name: string; aliases: string | null }>,
) {
  const list = customers
    .filter((c) => c.code)
    .map(
      (c) =>
        `${c.code}\t${c.name}${c.aliases ? "  (aka " + c.aliases + ")" : ""}`,
    )
    .join("\n");

  return `You transcribe a HANDWRITTEN daily aluminium-extrusion production report from RAC Extrusions Ltd into structured data. Read carefully and transcribe digits exactly as written — number accuracy matters most.

The columns USUALLY run left-to-right in the order below, but different report versions ADD OR DROP columns — e.g. CONTA TEMP and BILLET TEMP are MISSING on some forms, and EXTRU. SPEED sits right before DIE NO. So map every value by reading its OWN PRINTED column header, NOT by counting position. Common order:
S.No | Customer Name | CAST No. | ALLOY | EXTRU. SPEED | CONTA TEMP | BILLET TEMP | DIE NO. | CAVITY | CL | WT | GD PCS | BILLET SIZE | No. of BILLET | PCS PER BILLET | IN PUT | OUT PUT | REC% | Set-Up Rej. | Discard | TIME(IN/Out/Total) | Remark

Map each column to a field. The note in ( ) says what that cell should look like — use it to keep columns aligned and to catch drift:
- Customer Name  -> customer      (a party name/abbreviation, e.g. Axsys, K.i, M.M; match to the CUSTOMER LIST below and output the CODE)
- CAST No.       -> casting_no     (a short heat number, 1-3 digits, e.g. 42, 41)
- ALLOY          -> alloy          (an alloy grade code — letters/digits like HE9, HE30, HB, 6063, 6061; NEVER a plain decimal or a temperature)
- DIE NO.        -> section_no     (a 3-4 digit die/section number, e.g. 5478, 8080, 4512 — your clearest anchor column)
- CAVITY         -> cavity         (a single digit, 1 to 8)
- CL             -> cut_length     (a length in FEET, e.g. 12', 16'; transcribe as written, do NOT convert)
- WT             -> wt_pc          (weight per piece in kg, usually has a decimal, e.g. 18.00, 2.85, 6.15)
- GD PCS         -> produced_pcs   (a whole count of good pieces, e.g. 101, 20, 56)
- BILLET SIZE    -> billet_length_mm (billet LENGTH in mm, between 250 and 950 - 7-inch presses run up to 950, 5-inch presses up to 750, e.g. 440, 605, 660, 900 - a value under 250 means you grabbed the billet COUNT by mistake)
- No. of BILLET  -> no_billets     (a small count, e.g. 52, 2, 10)
- IN PUT         -> input_kg       (WHOLE kilograms, NO decimal point, e.g. 2230, 429, 338)
- OUT PUT        -> output_kg      (WHOLE kilograms, NO decimal point, e.g. 1818, 344, 260)
- TIME "IN"      -> die_load        (die-in / start clock time, HH:MM, e.g. 8:40)
- TIME "Out"     -> die_unload      (die-out / end clock time, HH:MM, e.g. 11:40)
- (charge group) -> charge         (billet-charge id — see MULTI-CUT BILLETS below; normally a unique value per line)

Three adjacent columns that are easy to swap — keep them straight:
      BILLET SIZE    = billet length in mm  -> billet_length_mm
      No. of BILLET  = number of billets    -> no_billets
      PCS PER BILLET = pieces per billet     -> IGNORE, never output it

ALIGNMENT CHECK (do this for EVERY row): confirm each value matches its column's description above. If something is off — an alloy code sitting in casting_no, a temperature in alloy, or a decimal inside IN PUT / OUT PUT — you have drifted by a column. Re-anchor on DIE NO. (the clear 3-4 digit number) and re-read the row outward from there.
DITTO MARKS: a " symbol or a repeated tick/stroke that looks like 11 means "same as the cell directly above" — carry the value from the row above down into this cell. This is common in CAST No. and ALLOY (the whole shift is usually one cast/alloy).

MULTI-CUT BILLETS — the "charge" field: usually one billet makes one length, but sometimes ONE billet is cut into MORE THAN ONE length of the SAME section. On the sheet that shows as two or more lines with the same section where BILLET SIZE and No. of BILLET are written on the FIRST line and blank/ditto on the line(s) below. Give every line of one billet charge the SAME "charge" value (e.g. "1"); start a new value ("2","3",…) for each new billet. A line with its own billet count is its own charge. When unsure, give each line a distinct value.

IGNORE entirely (never output): EXTRU. SPEED, CONTA TEMP, BILLET TEMP, PCS PER BILLET, REC%, Set-Up Rej., Discard. From the TIME group, READ the IN and Out clock times into die_load / die_unload; ignore only the TIME "Total" column.

RANGE CHECKS (use them to catch column drift): cavity is 1-8; billet_length_mm is 250-950. If cavity > 8 or billet_length_mm < 250, you have almost certainly mixed up the billet columns - re-read them.

HEADER (top of the sheet — applies to EVERY row; put once in "header"):
- DATE            -> date       (format YYYY-MM-DD if readable; e.g. "10/7/20.26" means 2026-07-10)
- SUPERVISOR NAME -> supervisor
- OPERATOR NAME   -> operator
- SHIFT           -> the SHIFT box often holds the shift AND the press, e.g. "B - P6" = shift B, press P6. Put the letter (A/B) in "shift" and the press (P1/P2/P4/P5/P6) in "press".

RULES:
- One object in "rows" per filled section/die line; skip blank rows.
- Transcribe numbers exactly. Blank or illegible cell -> "".
- customer: output the matching CODE (e.g. "S011"); if unsure, output the name as written. NEVER invent a code.

CUSTOMER LIST (CODE<TAB>Name):
${list}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY secret not set on this project" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad JSON body" }, 400);
  }
  const { image_base64, media_type, pin } = body ?? {};
  if (!image_base64) return json({ error: "image_base64 required" }, 400);

  // Gate: require a valid app PIN before spending any API credits.
  try {
    const u = await rest(
      `users?select=pin&pin=eq.${encodeURIComponent(String(pin ?? ""))}&limit=1`,
    );
    if (!Array.isArray(u) || u.length === 0) {
      return json({ error: "invalid PIN" }, 403);
    }
  } catch (e) {
    return json({ error: "PIN check failed: " + String(e) }, 500);
  }

  // Live customer list so name->code matching stays in sync with the DB.
  let customers: any[] = [];
  try {
    customers = await rest("customers?select=code,name,aliases&order=code");
  } catch {
    customers = [];
  }

  const anthReq = {
    model: MODEL,
    max_tokens: 20000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: buildSystem(customers) + (await buildCorrectionHints()),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: media_type || "image/jpeg",
              data: image_base64,
            },
          },
          {
            type: "text",
            text: "Transcribe this production report into the required JSON.",
          },
        ],
      },
    ],
  };

  console.log(
    "OCR img len", (image_base64 || "").length,
    "head", (image_base64 || "").slice(0, 16),
    "mt", media_type || "(none)",
  );
  let data: any;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(anthReq),
    });
    data = await r.json();
    if (!r.ok) {
      console.error("OCR anthropic fail", r.status, JSON.stringify(data).slice(0, 300));
      const msg = (data && data.error && data.error.message)
        ? ("Anthropic: " + data.error.message)
        : ("Anthropic HTTP " + r.status);
      return json({ error: msg, detail: data }, 502);
    }
  } catch (e) {
    console.error("OCR anthropic threw", String(e));
    return json({ error: "anthropic call failed: " + String(e) }, 502);
  }

  if (data.stop_reason === "refusal") {
    return json({ error: "model refused this image" }, 422);
  }
  // Bounded max_tokens means a very hard image can truncate mid-JSON. Say so
  // plainly rather than surfacing a confusing parse error.
  if (data.stop_reason === "max_tokens") {
    return json({
      error: "Report too long / too hard to read in one pass",
      hint: "Photograph one page at a time, or retake sharper and straighter.",
    }, 422);
  }

  const textBlock = (data.content || []).find((b: any) => b.type === "text");
  if (!textBlock) return json({ error: "no text in response", detail: data }, 502);

  let parsed: any;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return json({ error: "unparseable JSON", raw: textBlock.text }, 502);
  }

  // Flatten the shared header onto each row so the client grid gets flat records.
  const h = parsed.header || {};
  const rows = (parsed.rows || []).map((row: any) => ({
    date: h.date || "",
    shift: h.shift || "",
    press: h.press || "",
    supervisor: h.supervisor || "",
    operator: h.operator || "",
    ...row,
  }));

  return json({ rows, header: h, count: rows.length, usage: data.usage });
});
