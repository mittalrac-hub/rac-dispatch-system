/**
 * ==========================================================================
 *  FURNACE -> DISPATCH HEAT SYNC
 *  PASTE THIS INTO THE **FURNACE ERP** APPS SCRIPT PROJECT
 *  (the project with sheet "5. Furnace Casting" - NOT the dispatch project).
 *
 *  WHAT IT DOES: every hour, copies the last 45 days of heats (cast no, date,
 *  alloy, furnace, shift, billet dia/length, no. of billets, billet kg, yield)
 *  into the dispatch system's Supabase `heats` table, so:
 *    - a bundle traces back to its casting (alloy, billets, melt data)
 *    - billet stock by casting = billets cast - billets consumed by presses
 *    - wrong casting numbers / billet-length mismatches show in the
 *      incharge's Data Quality report.
 *
 *  SETUP (one time):
 *    1. Paste this whole file at the bottom of the furnace project's Code.gs
 *       (or as a new script file - either works).
 *    2. (Recommended) Add a column "Billet Length (mm)" on header row 3 of
 *       "5. Furnace Casting" and start filling it per heat - the sync picks
 *       it up automatically by header name.
 *    3. Run once from the editor:  syncHeatsToDispatch   -> check the log.
 *    4. Run once:  setupHeatSyncTrigger   -> creates the hourly auto-sync.
 *
 *  EDIT MARKS: everything you might need to change is in the CONFIG block.
 * ==========================================================================
 */

// -- CONFIG ------------------------------------------------------------------
var HSYNC_SHEET_NAME = '5. Furnace Casting';   // heat log sheet
var HSYNC_HEADER_ROW = 3;                      // headers on row 3, data from row 4
var HSYNC_DAYS_BACK  = 45;                     // how far back to (re)sync each run
// Dispatch system's Supabase (same project the dispatch app uses):
var HSYNC_SB_URL = 'https://qhvtrlktxfnvuijokkds.supabase.co';
var HSYNC_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFodnRybGt0eGZudnVpam9ra2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ5MDMsImV4cCI6MjA5Njg1MDkwM30.4QnrUEhuLJOoNccZCzYtSQfBdDjxOTDtnadzVMY06do';
// ----------------------------------------------------------------------------

function syncHeatsToDispatch() {
  var ssId = (typeof SS_ID !== 'undefined') ? SS_ID : '14yB-DbqpiSvSmAfrL9rOHm7PV73nYqNCNkwMmysSaZY';
  var sh = SpreadsheetApp.openById(ssId).getSheetByName(HSYNC_SHEET_NAME);
  if (!sh) { Logger.log('Sheet not found: ' + HSYNC_SHEET_NAME); return; }

  var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
  if (lastRow <= HSYNC_HEADER_ROW) { Logger.log('No data rows.'); return; }
  var headers = sh.getRange(HSYNC_HEADER_ROW, 1, 1, lastCol).getValues()[0]
                  .map(function (h) { return ('' + h).toLowerCase().replace(/\s+/g, ' ').trim(); });
  function col(names) {   // first header containing any of the given fragments
    for (var n = 0; n < names.length; n++)
      for (var i = 0; i < headers.length; i++)
        if (headers[i].indexOf(names[n]) >= 0) return i;
    return -1;
  }
  var C = {
    date:    col(['date']),
    heatNo:  col(['heat no', 'heat #', 'heat']),
    alloy:   col(['alloy']),
    shift:   col(['shift']),
    furnace: col(['furnace']),
    diaIn:   col(['billet dia']),                    // "Billet Dia (inch)"
    lenMm:   col(['billet length']),                 // add this column; -1 tolerated
    nBil:    col(['no. of billets', 'no of billets', 'number of billets']),
    bilKg:   col(['good billets', 'billet wt', 'billets wt']),
    yieldP:  col(['actual yield']),
    si:      col(['si (%', 'si(%', 'si %']),   // the "(%)" spectro columns, NOT the "(kg)" charge columns
    fe:      col(['fe (%', 'fe(%', 'fe %']),
    mg:      col(['mg (%', 'mg(%', 'mg %']),
    mn:      col(['mn (%', 'mn(%', 'mn %']),
    cu:      col(['cu (%', 'cu(%', 'cu %']),
    zn:      col(['zn (%', 'zn(%', 'zn %']),
    al:      col(['balance', 'al %', 'al(%'])  // "Al % [Balance]"
  };
  if (C.date < 0 || C.heatNo < 0) { Logger.log('Date / Heat No column not found. Headers: ' + headers.join(' | ')); return; }
  Logger.log('CHEM COLUMNS -> si:' + C.si + ' fe:' + C.fe + ' mg:' + C.mg + ' mn:' + C.mn + ' cu:' + C.cu + ' zn:' + C.zn + ' al:' + C.al +
             ((C.si < 0 && C.mg < 0) ? ('   | NO CHEM MATCH -- HEADERS: ' + headers.join(' | ')) : '   (found; if all >=0 chem will sync)'));

  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - HSYNC_DAYS_BACK); cutoff.setHours(0, 0, 0, 0);
  var rows = sh.getRange(HSYNC_HEADER_ROW + 1, 1, lastRow - HSYNC_HEADER_ROW, lastCol).getValues();

  function num(v) { if (v === '' || v == null) return null; var n = Number(v); return isNaN(n) ? null : n; }
  function pct(v) { var n = num(v); if (n == null) return null; return n <= 1.5 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10; } // sheet stores fractions

  var byKey = {}, scanned = 0;
  rows.forEach(function (r) {
    var d = r[C.date];
    if (!(d instanceof Date)) { if (d) { d = new Date(d); } else { return; } }
    if (isNaN(d.getTime()) || d < cutoff) return;
    var heatNo = ('' + r[C.heatNo]).trim();
    if (!heatNo) return;
    scanned++;
    var rec = {
      cast_no:          heatNo,
      cast_date:        Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
      alloy:            C.alloy   >= 0 ? (('' + r[C.alloy]).trim()   || null) : null,
      furnace:          C.furnace >= 0 ? (('' + r[C.furnace]).trim() || null) : null,
      shift:            C.shift   >= 0 ? (('' + r[C.shift]).trim()   || null) : null,
      billet_dia_in:    C.diaIn   >= 0 ? num(('' + r[C.diaIn]).replace(/[^0-9.]/g, '')) : null,  // '5"' -> 5
      billet_length_mm: C.lenMm   >= 0 ? num(r[C.lenMm]) : null,
      num_billets:      C.nBil    >= 0 ? num(r[C.nBil])  : null,
      billet_kg:        C.bilKg   >= 0 ? num(r[C.bilKg]) : null,
      yield_pct:        C.yieldP  >= 0 ? pct(r[C.yieldP]) : null,
      si_pct:           C.si >= 0 ? num(r[C.si]) : null,   // stored as-is (0.48 = 0.48%)
      fe_pct:           C.fe >= 0 ? num(r[C.fe]) : null,
      mg_pct:           C.mg >= 0 ? num(r[C.mg]) : null,
      mn_pct:           C.mn >= 0 ? num(r[C.mn]) : null,
      cu_pct:           C.cu >= 0 ? num(r[C.cu]) : null,
      zn_pct:           C.zn >= 0 ? num(r[C.zn]) : null,
      al_pct:           C.al >= 0 ? num(r[C.al]) : null
    };
    byKey[rec.cast_no + '|' + rec.cast_date] = rec;   // last row wins on duplicates
  });

  var recs = Object.keys(byKey).map(function (k) { return byKey[k]; });
  if (!recs.length) { Logger.log('Nothing to sync (0 heats in the last ' + HSYNC_DAYS_BACK + ' days).'); return; }
  var ok = 0, fail = 0;
  for (var i = 0; i < recs.length; i += 200) {
    var chunk = recs.slice(i, i + 200);
    var res = UrlFetchApp.fetch(HSYNC_SB_URL + '/rest/v1/heats?on_conflict=cast_no,cast_date', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: HSYNC_SB_KEY, Authorization: 'Bearer ' + HSYNC_SB_KEY, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(chunk), muteHttpExceptions: true
    });
    if (res.getResponseCode() < 300) ok += chunk.length;
    else { fail += chunk.length; Logger.log('Chunk error HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); }
  }
  Logger.log('Heat sync: scanned ' + scanned + ' rows -> ' + recs.length + ' heats; upserted ' + ok + ', failed ' + fail +
             (C.lenMm < 0 ? '  (NOTE: no "Billet Length" column found yet - add it to row 3 to sync lengths)' : ''));
}

// One-time: hourly auto-sync trigger (safe to re-run; replaces any existing one).
function setupHeatSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncHeatsToDispatch') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncHeatsToDispatch').timeBased().everyHours(1).create();
  Logger.log('Hourly heat sync trigger created.');
}
