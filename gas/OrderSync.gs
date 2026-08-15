/**
 * RAC Extrusions — Order-list → Supabase sync (Google Apps Script)
 * ---------------------------------------------------------------
 * Reads the "Order list" sheet, resolves standard-profile section numbers from
 * the catalogue, canonicalises cut length to mm, and mirrors every order line
 * into Supabase `order_book`. Install a time-driven trigger on syncOrders().
 *
 * SETUP (one time):
 *   1. Open the Order-list Google Sheet → Extensions → Apps Script.
 *   2. Paste this file, Save.
 *   3. Run syncOrders() once (authorise when prompted) — check the log.
 *   4. Triggers (clock icon) → Add trigger → syncOrders → Time-driven →
 *      Hour timer → every 2 (or 4) hours. Save.
 */

var SB_URL = 'https://qhvtrlktxfnvuijokkds.supabase.co';
var SB_KEY = 'sb_publishable_DcvIumd6LZaeq8xCyhk9GA_Eew-QZ9V';
var SHEET_ID = '1e1uNLfKTWS0OLEl0IQ6tlBDi2ovhUeuevm53HLCI6xQ';
var SHEET_NAME = 'Order list';

// ---- Supabase REST helpers ----------------------------------------------
function sbFetch(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json' }, opts.headers || {});
  opts.muteHttpExceptions = true;
  var r = UrlFetchApp.fetch(SB_URL + '/rest/v1/' + path, opts);
  if (r.getResponseCode() >= 300) throw new Error(path + ' -> ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
  var t = r.getContentText();
  return t ? JSON.parse(t) : null;
}

// ---- Catalogue-based section resolver -----------------------------------
function loadCatalogue() {
  var rows = sbFetch('standard_sections?select=family,section_no,d1,d2,d3,wt_lo,wt_hi', { method: 'get' });
  return rows.map(function (r) {
    var dims = [r.d1, r.d2, r.d3].filter(function (x) { return x !== null && x !== undefined; }).map(Number);
    return { family: r.family, section_no: r.section_no, dims: dims, wt_lo: r.wt_lo, wt_hi: r.wt_hi };
  });
}
function normOrder(text) {
  var t = (text || '').toString().toUpperCase(), fam = null;
  if (/R\.?\s*PIPE|\bRP\b/.test(t)) fam = 'RTUBEO';
  else if (/\bRT\b|RECT/.test(t)) fam = 'RTUBE';
  else if (/SQ\s*PIPE|SQ\s*TUBE/.test(t)) fam = 'STUBE';
  else if (/\bANGLE\b/.test(t)) fam = 'ANGLE';
  else if (/FLAT/.test(t)) fam = 'FLAT';
  else if (/\bSQ\b|SQUARE|SQ ROD/.test(t)) fam = 'SQ?';
  else if (/ROUND\s*BAR|\bRB\b/.test(t)) fam = 'RBAR';
  var nums = (t.replace(/MM/g, ' ').match(/\d+(\.\d+)?/g) || []).map(Number);
  return { fam: fam, nums: nums };
}
function resolveSection(text, wrLo, wrHi, cat) {
  var n = normOrder(text); if (!n.fam || !n.nums.length) return null;
  var fam = n.fam, nums = n.nums, given, tol = 0.2;
  if (fam === 'RTUBEO') { given = [nums[0]]; }                                   // OD only; weight sets wall
  else if (fam === 'SQ?') { if (nums.length === 1) { fam = 'SBAR'; given = [nums[0]]; } else { fam = 'STUBE'; given = nums.slice(0, 2); } }
  else { var nd = { FLAT: 2, ANGLE: 3, RTUBE: 3, STUBE: 2, RBAR: 1, SBAR: 1 }[fam]; given = nums.slice(0, nd); }
  function dmatch(a, b) {
    if (b.length < a.length) return false;
    if (fam === 'ANGLE' || fam === 'RTUBE') {
      var a2 = a.slice(0, 2).sort(), b2 = b.slice(0, 2).sort();
      for (var i = 0; i < 2; i++) if (Math.abs(a2[i] - b2[i]) > tol) return false;
      for (var j = 2; j < a.length; j++) if (Math.abs(a[j] - b[j]) > tol) return false;
      return true;
    }
    for (var k = 0; k < a.length; k++) if (Math.abs(a[k] - b[k]) > tol) return false;
    return true;
  }
  var hits = cat.filter(function (r) { return r.family === fam && dmatch(given, r.dims); });
  var by = 'catalogue';
  if (hits.length > 1 && wrLo != null) {
    var f = hits.filter(function (h) { return !(h.wt_hi < wrLo - 0.05 || h.wt_lo > wrHi + 0.05); });
    if (f.length === 1) { hits = f; by = 'catalogue+wt'; } else if (f.length) hits = f;
  }
  if (hits.length !== 1 && n.fam === 'SQ?' && nums.length === 1 && wrLo != null) {   // square, no wall -> try tube by OD+wt
    var st = cat.filter(function (r) { return r.family === 'STUBE' && Math.abs(r.dims[0] - nums[0]) < tol; })
                .filter(function (h) { return !(h.wt_hi < wrLo - 0.05 || h.wt_lo > wrHi + 0.05); });
    if (st.length === 1) return { section_no: st[0].section_no, by: 'catalogue+wt' };
  }
  if (hits.length === 1) return { section_no: hits[0].section_no, by: by };
  return null;
}

// ---- Field parsers -------------------------------------------------------
function canonCutMm(raw) {
  var s = (raw == null ? '' : raw).toString().trim().toUpperCase(); if (!s) return null;
  if (/MM/.test(s)) { var m = s.match(/(\d+(\.\d+)?)/); return m ? Math.round(parseFloat(m[1])) : null; }
  var fi = s.match(/(\d+)\s*'\s*-?\s*(\d+)\s*(?:''|")/);                 // feet-inches: 11'-4"
  if (fi) return Math.round(parseInt(fi[1], 10) * 305 + parseInt(fi[2], 10) * 25.4);
  if (/(''|")/.test(s) && !/'/.test(s)) { var im = s.match(/(\d+(\.\d+)?)/); return im ? Math.round(parseFloat(im[1]) * 25.4) : null; }
  var fm = s.match(/(\d+(\.\d+)?)/); if (!fm) return null;   // 12' or bare 12 -> feet; bare >=100 treated as mm
  var v = parseFloat(fm[1]); return Math.round(/'/.test(s) || v < 100 ? v * 305 : v);
}
function parseWtRange(raw) {
  var s = (raw == null ? '' : raw).toString();
  var m = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}
function parseQty(raw) {
  var s = (raw == null ? '' : raw).toString().trim(); if (!s) return { qty: null, unit: null };
  var num = (s.match(/[\d.]+/) || [])[0]; num = num ? parseFloat(num) : null;
  var unit = /pc|ps\b/i.test(s) ? 'pcs' : (/kg/i.test(s) ? 'kg' : null);
  return { qty: num, unit: unit };
}
function parseDate(raw) {
  var s = (raw == null ? '' : raw).toString().trim().replace(/\.$/, ''); if (!s) return null;
  if (Object.prototype.toString.call(raw) === '[object Date]') return Utilities.formatDate(raw, 'GMT', 'yyyy-MM-dd');
  var m = s.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/); if (!m) return null;
  var d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = m[3] ? parseInt(m[3], 10) : 2026;
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return Utilities.formatDate(new Date(y, mo - 1, d, 12, 0, 0), 'GMT', 'yyyy-MM-dd');
}
function looksProfile(name) {
  return /\d+\s*[*xX]\s*\d+|FLAT|\bRP\b|\bRT\b|R\.?PIPE|\bSQ\b|SQUARE|ANGLE|CHANNEL|TUBE|LADDER|CLIP|CLEAT|GLASS|CW |CURTAIN|MAXIMA|Z LINE|HANDLE|INTERLOCK|DTS|DTD|DMD/i.test(name || '');
}

// The profile blacklist above contains GLASS (for glass-bead / glass-clip
// sections), which also matches the customer "Shankar Glass". That made its
// customer band read as a profile description, so the band never switched and
// every following line was filed under the previous customer (INALCO).
// A name that matches a real customer record is a customer band, full stop.
var KNOWN_CUSTOMERS = null;
function loadCustomerNames() {
  var rows = sbFetch('customers?select=name,code,aliases', { method: 'get' }) || [];
  var m = {};
  rows.forEach(function (c) {
    if (c.name) m[normName(c.name)] = 1;
    if (c.code) m[normName(c.code)] = 1;
    if (c.aliases) String(c.aliases).split(';').forEach(function (a) {
      a = normName(a); if (a) m[a] = 1;
    });
  });
  return m;
}
function normName(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function norm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Header text -> field. First match wins, so put the more specific spellings first.
var HEADER_SYNONYMS = {
  secno:      ['newsecno', 'newsectionno', 'secno', 'sectionno'],
  name:       ['sectionname', 'section', 'name', 'description', 'item'],
  cl:         ['cl', 'cutlength', 'cuttinglength', 'length'],
  qty:        ['qty', 'quantity', 'orderqty', 'orderquantity'],
  weight:     ['weightrange', 'wtrange', 'weight', 'wt'],
  po:         ['po', 'ponumber', 'pono'],
  date:       ['date', 'orderdate'],
  alloy:      ['alloy', 'grade'],
  pcs:        ['pcs', 'pieces', 'nopcs'],
  stock:      ['stock', 'stockkg', 'instock'],
  pod:        ['pod', 'prodyest', 'productionyesterday', 'prodlastday'],
  rate:       ['rate', 'price']
};
// Every header spelling we recognise, flattened. Used to SCORE rows rather than
// require one specific cell: demanding "New Sec No" failed because the real sheet
// words that column differently, and guessing spellings one at a time does not
// converge. The header is simply the row that looks most like a header.
function headerTokens_() {
  var t = {};
  for (var f in HEADER_SYNONYMS) HEADER_SYNONYMS[f].forEach(function (s) { t[s] = 1; });
  ['srno', 'sno', 'sr', 'partyname', 'customer', 'remark', 'remarks', 'status',
   'delivery', 'deliverydate', 'balance', 'pending', 'dispatch', 'dispatched'
  ].forEach(function (s) { t[s] = 1; });
  return t;
}
function scoreRow_(row, toks) {
  var hits = 0, seen = {};
  for (var c = 0; c < row.length; c++) {
    var n = norm_(row[c]);
    if (!n || n.length > 24 || seen[n]) continue;
    if (toks[n]) { hits++; seen[n] = 1; }
  }
  return hits;
}
// Returns {row:index, score:n} for the best header candidate, or {row:-1}.
function findHeaderInfo_(vals) {
  var toks = headerTokens_(), best = { row: -1, score: 0 };
  for (var i = 0; i < vals.length; i++) {
    var s = scoreRow_(vals[i], toks);
    if (s > best.score) best = { row: i, score: s };
    if (s >= 6) break;                       // unmistakably the header, stop early
  }
  return best;
}
function findHeaderRow_(vals) {
  var b = findHeaderInfo_(vals);
  return (b.score >= 3) ? b.row : -1;        // 3+ recognised column names = header
}
function buildColMap_(hdrRow) {
  var map = {}, taken = {};
  for (var f in HEADER_SYNONYMS) {
    var syns = HEADER_SYNONYMS[f];
    for (var s = 0; s < syns.length && map[f] == null; s++) {
      for (var c = 0; c < hdrRow.length; c++) {
        if (taken[c]) continue;
        if (norm_(hdrRow[c]) === syns[s]) { map[f] = c; taken[c] = 1; break; }
      }
    }
  }
  Logger.log('Column map: ' + JSON.stringify(map));
  return map;
}
function isKnownCustomer(name) {
  if (!name) return false;
  if (!KNOWN_CUSTOMERS) KNOWN_CUSTOMERS = loadCustomerNames();
  return !!KNOWN_CUSTOMERS[normName(name)];
}

// Only six alloys exist: HE9, HARD, SPL, 63400, 6063, 6061. The sheet carries
// punctuation and thickness suffixes ("HE-9", "S.P.L 3MM") which would otherwise
// key as distinct alloys and stop stock matching its order line.
var OB_ALLOYS = ['HE9', 'HARD', 'SPL', '63400', '6063', '6061'];
function canonAlloy(a) {
  var s = String(a == null ? '' : a).toUpperCase().trim();
  // strip a trailing size token only when separated — "HE-9 3MM" must not lose its 9
  s = s.replace(/[\s\-.,/]+\d+(\.\d+)?\s*MM\.?$/, '');
  s = s.replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (OB_ALLOYS.indexOf(s) >= 0) return s;
  for (var i = 0; i < OB_ALLOYS.length; i++) {
    if (s.indexOf(OB_ALLOYS[i]) === 0) return OB_ALLOYS[i];
  }
  return s;
}

// ---- Main ----------------------------------------------------------------
function syncOrders() {
  var cat = loadCatalogue();
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Locate the order list by finding its header, not by trusting a tab name.
  // The tab called "Order list" currently starts with a production summary
  // (a date, "INPUT", tonnages), so the sheet has either been restructured or
  // the orders have moved elsewhere in the workbook. Search the named tab first,
  // then every other tab, and say plainly what was found if none match.
  var sh = null, data = null, found = -1;
  var tried = [], diag = [];
  var wanted = norm_(SHEET_NAME);
  var ordered = [], rest = [];
  ss.getSheets().forEach(function (s) {
    if (norm_(s.getName()) === wanted) ordered.push(s); else rest.push(s);
  });
  ordered = ordered.concat(rest);            // preferred tab first, case-insensitively

  for (var si = 0; si < ordered.length && found < 0; si++) {
    var cand = ordered[si];
    var vals = cand.getDataRange().getValues();
    var info = findHeaderInfo_(vals);
    tried.push(cand.getName() + ' (' + vals.length + ' rows, best match ' + info.score + ')');
    if (info.score >= 3) { sh = cand; data = vals; found = info.row; }
    else if (norm_(cand.getName()) === wanted && info.row >= 0) {
      // remember what the closest row looked like, so the error can show it
      diag.push('closest row in "' + cand.getName() + '" is row ' + (info.row + 1) +
                ': ' + JSON.stringify((vals[info.row] || []).slice(0, 14)));
      for (var d = 0; d < Math.min(vals.length, 6); d++) {
        diag.push('  row ' + (d + 1) + ': ' + JSON.stringify((vals[d] || []).slice(0, 14)));
      }
    }
  }

  if (found < 0) {
    throw new Error('Order-list header not found.\n' +
      'A header row must contain at least 3 recognised column names ' +
      '(Sec No / Section Name / C/L / Qty / Alloy / PO / Date / STOCK / RATE / Customer …).\n' +
      'Tabs searched: ' + tried.join(' | ') + '\n' + diag.join('\n'));
  }
  if (sh.getName() !== SHEET_NAME) {
    Logger.log('NOTE: order list header found in tab "' + sh.getName() +
               '", not "' + SHEET_NAME + '". Using that tab.');
  }

  var hdr = found, hdrRow = data[found];

  // Map each field to its column BY HEADER TEXT, so inserting or moving a column
  // no longer silently shifts every value into the wrong field.
  var COLMAP = buildColMap_(hdrRow);
  function cellAt(row, field, fallbackIdx) {
    var idx = (COLMAP[field] == null) ? fallbackIdx : COLMAP[field];
    if (idx == null || idx < 0 || idx >= row.length) return '';
    return row[idx];
  }

  var out = [], customer = null;
  for (var r = hdr + 1; r < data.length; r++) {
    var row = data[r];
    var secno = String(cellAt(row, 'secno', 0) || '').trim();
    var name  = String(cellAt(row, 'name',  1) || '').trim();
    var cl    = String(cellAt(row, 'cl',    2) || '').trim();
    var qty   = String(cellAt(row, 'qty',   3) || '').trim();
    if (!secno && !name && !cl && !qty) continue;                        // spacer
    // customer band: a name with no order quantity. A name that matches a real
    // customer record wins outright — it is never a profile description, and it
    // survives a stray value left in the section / cut columns of that row.
    if (name && !qty && isKnownCustomer(name)) { customer = name; continue; }
    if (name && !secno && !cl && !qty && !looksProfile(name) && name.length < 60 && !/^[\w-]{25,}$/.test(name)) { customer = name; continue; }
    if (!cl && !qty) continue;                                           // subtotal / stray
    if (!secno && !name) continue;

    var wr = String(cellAt(row, 'weight', 4) || '').trim();
    var wrp = parseWtRange(wr);
    var resolvedBy = null, sec = secno;
    if (!sec && name) {
      var res = resolveSection(name, wrp ? wrp[0] : null, wrp ? wrp[1] : null, cat);
      if (res) { sec = res.section_no; resolvedBy = res.by; }
    } else if (sec) { resolvedBy = 'given'; }

    var q = parseQty(qty);
    var wtpc = (q.unit === 'pcs' && wrp) ? (wrp[0] + wrp[1]) / 2 : null;
    out.push({
      row_index: r,
      customer: customer,
      section_no: sec ? String(sec) : null,
      // A sheet cell holding a picture reads back as the literal "CellImage";
      // that is not a section name, so drop it rather than storing it.
      section_text: (/^\s*cellimage\s*$/i.test(name) ? null : (name || null)),
      resolved_by: resolvedBy,
      cut_raw: cl || null,
      cut_mm: canonCutMm(cl),
      qty_raw: qty || null,
      order_qty: q.qty,
      order_unit: q.unit,
      weight_range: wr || null,
      wt_pc: wtpc,
      alloy: canonAlloy(cellAt(row, 'alloy', 7)),
      po: String(cellAt(row, 'po', 5) || '').trim() || null,
      order_date: parseDate(cellAt(row, 'date', 6)),
      order_date_raw: String(cellAt(row, 'date', 6) || '').trim() || null,
      pcs_col: String(cellAt(row, 'pcs', 8) || '').trim() || null,
      stock_col: String(cellAt(row, 'stock', 9) || '').trim() || null,
      pod: String(cellAt(row, 'pod', 10) || '').trim() || null,
      rate: String(cellAt(row, 'rate', 12) || '').trim() || null,
      sheet_status: String(row[13] == null ? '' : row[13]).trim() || null
    });
  }

  // Guard before the destructive clear. On a 30-minute trigger the sync will
  // sometimes run while the sheet is being edited (the ~11am dispatch deduction),
  // and delete-then-reinsert would leave the portal showing a half-written order
  // book until the next run. If this read produced far fewer rows than what is
  // already stored, treat it as a mid-edit snapshot and skip — the next run in
  // 30 minutes picks up the finished sheet.
  var existing = sbFetch('order_book?select=id', { method: 'get' }) || [];
  var prev = existing.length;
  if (out.length === 0 && prev > 0) {
    Logger.log('ABORTED: parsed 0 rows but %s are stored. Sheet likely mid-edit; leaving data untouched.', prev);
    return { total: 0, skipped: true, reason: 'parsed 0 rows' };
  }
  if (prev >= 20 && out.length < prev * 0.5) {
    Logger.log('ABORTED: parsed only %s rows vs %s stored (>50%% drop). Sheet likely mid-edit; leaving data untouched.', out.length, prev);
    return { total: out.length, skipped: true, reason: 'row count halved' };
  }

  // mirror: clear then bulk insert
  sbFetch('order_book?id=gt.0', { method: 'delete', headers: { Prefer: 'return=minimal' } });
  for (var c = 0; c < out.length; c += 200) {
    sbFetch('order_book', { method: 'post', headers: { Prefer: 'return=minimal' },
      payload: JSON.stringify(out.slice(c, c + 200)) });
  }
  var needs = out.filter(function (o) { return o.section_text && !o.section_no; }).length;
  var resolved = out.filter(function (o) { return o.resolved_by && o.resolved_by.indexOf('catalogue') === 0; }).length;
  Logger.log('synced %s orders | %s auto-resolved from catalogue | %s still need a section', out.length, resolved, needs);
  return { total: out.length, resolved: resolved, needs: needs };
}
