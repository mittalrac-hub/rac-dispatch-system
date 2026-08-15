/**
 * RAC DISPATCH SYSTEM  —  fool-proofed grid entry
 * ----------------------------------------------------------------------------
 * Operators type into the small ENTRY tabs (Ageing Entry / Packing Entry /
 * Production Entry). When done, tick the checkbox in cell A1 -> the rows are
 * pushed (with IDs, dates, customer-id, Webster result, Kg all computed) into
 * the hidden storage tabs (Ageing / Ready / Production) and the entry grid
 * CLEARS. The entry tab never grows, so it never scrolls or lags.
 *
 * AFTER PASTING: Ctrl+S, reload the sheet, RAC System -> 1. Set up workbook.
 * ----------------------------------------------------------------------------
 */

var BRAND_GREEN = '#1e4620';
var OLD_ORDER_LIST_ID = '1e1uNLfKTWS0OLEl0IQ6tlBDi2ovhUeuevm53HLCI6xQ';
var WEBSTER_MIN = 7;
var SB_URL = 'https://qhvtrlktxfnvuijokkds.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFodnRybGt0eGZudnVpam9ra2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ5MDMsImV4cCI6MjA5Njg1MDkwM30.4QnrUEhuLJOoNccZCzYtSQfBdDjxOTDtnadzVMY06do';

var SCHEMA = {
  'Orders':     ['Order Line ID','Customer ID','Customer Name','Section No','Section Name','Cut Length','Ordered Qty','Unit','PO Number','Order Date','Alloy','Price','Status','Notes'],
  'Production': ['Prod ID','Date','Shift','Press','Die No','Section Name','Alloy','Cut Length','Wt/Pc','Good Pcs','Kg','Customer','Customer ID','Notes'],
  'Ageing':     ['Clear ID','Date','Shift','Aging No','Section No','Customer','Customer ID','Cut Length','Wt/Pc','Total Weight','Finish','Webster','Result','Out Time','Cleared By','Remarks'],
  'Ready':      ['Bundle No','Section No','Section Name','Cut Length','Bundle Wt','Pcs','Customer','Customer ID','Packed Date','Packed By','Status','Remarks'],
  'Dispatch':   ['Dispatch ID','Date','Vehicle No','Customer ID','Bundle Nos','Gross Wt','Tare Wt','Net Wt','Invoice No','Notes'],
  'Report':     ['Customer ID','Customer Name','Section No','Section Name','Ordered','Produced (in process)','Ready to Dispatch','Pending','ETA','Updated']
};

var ENTRY = {
  'Ageing Entry':     ['Shift','Aging No','Section No','Customer','Cut Length','Wt/Pc','Total Weight','Finish','Webster','Cleared By','Remarks'],
  'Packing Entry':    ['Bundle No','Section No','Section Name','Cut Length','Bundle Wt','Pcs','Customer','Packed By','Remarks'],
  'Production Entry':  ['Shift','Press','Die No','Section Name','Alloy','Cut Length','Wt/Pc','Good Pcs','Customer','Notes']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RAC System')
    .addItem('1. Set up workbook', 'setupWorkbook')
    .addItem('2. Import orders from old list', 'importOrders')
    .addItem('3. Import customer numbers', 'importCustomerPhones')
    .addItem('Load demo data (40 rows)', 'loadDemoData')
    .addSeparator()
    .addItem('Submit current entry tab', 'submitActive')
    .addToUi();
}

/* ===== submit: tick A1 on an entry tab, or use the menu ===== */

function onEdit(e) {
  try {
    if (e.range.getA1Notation() !== 'A1' || e.range.getValue() !== true) return;
    submitByName_(e.range.getSheet().getName());
  } catch (err) {}
}
function submitActive() { submitByName_(SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName()); }
function submitByName_(name) {
  if (name === 'Ageing Entry') submitTab_('Ageing Entry', 'ageing', ageMap_);
  else if (name === 'Packing Entry') submitTab_('Packing Entry', 'ready', packMap_);
  else if (name === 'Production Entry') submitTab_('Production Entry', 'production', prodMap_);
}

function submitTab_(entryName, table, mapFn) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var en = ss.getSheetByName(entryName);
  var lastRow = en.getLastRow(), recs = [];
  if (lastRow >= 3) {
    var vals = en.getRange(3, 1, lastRow - 2, en.getLastColumn()).getValues();
    vals.forEach(function (r) { if (r.join('').replace(/\s/g, '') !== '') recs.push(mapFn(ss, r)); });
  }
  if (table === 'ready') recs = recs.filter(function (x) { return x.bundle_no; });
  if (!recs.length) { en.getRange('A1').setValue(false); ss.toast('Nothing to submit.'); return; }
  try {
    postSupabase_(table, recs);
    en.getRange(3, 1, Math.max(lastRow - 2, 1), en.getLastColumn()).clearContent();
    ss.toast(recs.length + ' row(s) saved to Supabase (' + table + ').', 'Submitted', 6);
  } catch (e) {
    ss.toast('Save failed — ' + e.message, 'Error', 12);
  }
  en.getRange('A1').setValue(false);
}

function postSupabase_(table, records) {
  var res = UrlFetchApp.fetch(SB_URL + '/rest/v1/' + table, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' },
    payload: JSON.stringify(records), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Supabase ' + code + ': ' + res.getContentText().slice(0, 200));
}

function ageMap_(ss, r) {
  return { shift: nz_(r[0]), aging_no: nz_(r[1]), section_no: nz_(r[2]), customer_id: custLookup_(ss, r[3]) || null,
    cut_length: nz_(r[4]), wt_pc: numN_(r[5]), total_weight: numN_(r[6]), finish: nz_(r[7]), webster: nz_(r[8]),
    result: websterResult_(r[8]), entry_date: dateISO_(), out_time: timeISO_(), cleared_by: nz_(r[9]), remarks: nz_(r[10]) };
}
function packMap_(ss, r) {
  return { bundle_no: nz_(r[0]), section_no: nz_(r[1]), section_name: nz_(r[2]), cut_length: nz_(r[3]),
    bundle_wt: numN_(r[4]), pcs: numN_(r[5]), customer_id: custLookup_(ss, r[6]) || null,
    packed_date: dateISO_(), packed_by: nz_(r[7]), status: 'In Stock', remarks: nz_(r[8]) };
}
function prodMap_(ss, r) {
  var wt = numN_(r[6]), pc = numN_(r[7]);
  return { shift: nz_(r[0]), press: nz_(r[1]), die_no: nz_(r[2]), section_name: nz_(r[3]), alloy: nz_(r[4]),
    cut_length: nz_(r[5]), wt_pc: wt, good_pcs: pc, kg: (wt != null && pc != null) ? Math.round(wt * pc * 10) / 10 : null,
    customer_id: custLookup_(ss, r[8]) || null, entry_date: dateISO_(), notes: nz_(r[9]) };
}
function nz_(v) { v = (v == null ? '' : String(v)).trim(); return v === '' ? null : v; }
function numN_(v) { v = (v == null ? '' : String(v)).trim(); return v === '' ? null : Number(v); }
function dateISO_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }
function timeISO_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm:ss'); }

/* ============================== DEMO DATA =============================== */

function loadDemoData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // [customer, press, dieNo, sectionName, alloy, cutLength, wtPc, goodPcs]
  var P = [
    ['RAM AVTAR &CO', '1100-A', '6286', 'SQ ROD 12.7MM', '6061', "12'", 1.5, 200],
    ['RAM AVTAR &CO', '1100-A', '3437', '', 'HE9', '12', 2.0, 130],
    ['RAM AVTAR &CO', '1800', '4290', '', 'HE9', '12', 3.9, 210],
    ['Padmavati', '900-A', '3647', '', 'HE9', '4900MM', 1.2, 137],
    ['Padmavati', '900-A', '2503', '', 'HE9', '3800MM', 1.0, 64],
    ['Padmavati', '1100-B', '1610', '83*44 DV', 'HE9', '5200MM', 7.7, 14],
    ['VEDAANT', '1800', '5898', '', 'HE9', '4630MM', 0.6, 500],
    ['VEDAANT', '1800', '5424', '', 'HE9', '4630MM', 0.6, 150],
    ['Axsys', '1100-A', '5276', '', 'HE9', '5000MM', 1.1, 88],
    ['Axsys', '1100-A', '8024', '', 'HE9', '4550MM', 1.3, 200],
    ['KEPL', '1100-B', '8008', '', 'HE9', "12'", 4.5, 250],
    ['KEPL', '900-B', '3910', '', 'HE9', '12', 2.0, 300],
    ['SR', '900-A', '4546', '', 'HE9', '15', 2.5, 142],
    ['MITTAL METALLOYS', '900-B', '', 'Rod 6MM', 'HE9', '14', 0.33, 600]
  ];
  // [agingNo, sectionNo, customer, cutLength, wtPc, totalWeight, finish, webster]
  var A = [
    ['2', '5898', 'VEDAANT', '4630', 0.6, 300, 'Mill', '10,12,10,11,12'],
    ['2', '5424', 'VEDAANT', '4630', 0.6, 90, 'Mill', '11,10,11,12,10'],
    ['1', '3647', 'Padmavati', '4900', 1.2, 164, 'Mill', '12,10,11,12,10'],
    ['1', '2503', 'Padmavati', '3800', 1.0, 64, 'Mill', '10,10,10,11'],
    ['1', '1610', 'Padmavati', '5200', 7.7, 108, 'Mill', '10,9,8,9,9'],
    ['3', '6286', 'RAM AVTAR &CO', '12', 1.5, 300, 'Mill', '11,10,11,9,10'],
    ['3', '3437', 'RAM AVTAR &CO', '12', 2.0, 260, 'Mill', '8,7,8,7,9'],
    ['3', '4290', 'RAM AVTAR &CO', '12', 3.9, 410, 'Mill', '6,7,6,8'],
    ['2', '5276', 'Axsys', '5000', 1.1, 97, 'Powder coat', '10,11,10,9,10'],
    ['2', '8024', 'Axsys', '4550', 1.3, 260, 'Mill', '9,10,11,9,10'],
    ['4', '8008', 'KEPL', '12', 4.5, 1100, 'Mill', '12,11,10,11,12'],
    ['4', '3910', 'KEPL', '12', 2.0, 600, 'Mill', '5,6,7,8'],
    ['1', '4546', 'SR', '15', 2.5, 355, 'Mill', '10,9,10,11,9']
  ];
  // [bundleNo, sectionNo, sectionName, cutLength, bundleWt, pcs, customer, packedBy]
  var R = [
    ['GZ557', '5898', '', '4630', 62.5, 100, 'VEDAANT', 'RK'],
    ['GZ558', '5898', '', '4630', 56.5, 90, 'VEDAANT', 'RK'],
    ['HA37', '3647', '', '4900', 57.3, 48, 'Padmavati', 'AS'],
    ['HA38', '3647', '', '4900', 57.4, 48, 'Padmavati', 'AS'],
    ['HA40', '2503', '', '3800', 40.0, 64, 'Padmavati', 'AS'],
    ['GY708', '6286', 'SQ ROD 12.7MM', '12', 75.2, 50, 'RAM AVTAR &CO', 'RK'],
    ['GY709', '6286', 'SQ ROD 12.7MM', '12', 75.3, 50, 'RAM AVTAR &CO', 'RK'],
    ['GY710', '3437', '', '12', 60.1, 30, 'RAM AVTAR &CO', 'RK'],
    ['HA450', '5276', '', '5000', 66.3, 60, 'Axsys', 'RK'],
    ['HA451', '5276', '', '5000', 66.1, 60, 'Axsys', 'RK'],
    ['HA130', '8008', '', '12', 46.1, 10, 'KEPL', 'RK'],
    ['HA131', '8008', '', '12', 46.0, 10, 'KEPL', 'RK'],
    ['HA125', '4546', '', '15', 31.9, 13, 'SR', 'RK']
  ];

  var prod = P.map(function (d) { var wt = d[6], pc = d[7]; return { shift: 'A', press: d[1], die_no: d[2], section_name: d[3] || null, alloy: d[4], cut_length: d[5], wt_pc: wt, good_pcs: pc, kg: Math.round(wt * pc * 10) / 10, customer_id: custLookup_(ss, d[0]) || null, entry_date: dateISO_() }; });
  var age = A.map(function (d) { return { shift: 'A', aging_no: d[0], section_no: d[1], customer_id: custLookup_(ss, d[2]) || null, cut_length: d[3], wt_pc: d[4], total_weight: d[5], finish: d[6], webster: d[7], result: websterResult_(d[7]), entry_date: dateISO_(), out_time: timeISO_(), cleared_by: 'Rajesh' }; });
  var ready = R.map(function (d) { return { bundle_no: d[0], section_no: d[1], section_name: d[2] || null, cut_length: d[3], bundle_wt: d[4], pcs: d[5], customer_id: custLookup_(ss, d[6]) || null, packed_date: dateISO_(), packed_by: d[7], status: 'In Stock' }; });
  try {
    postSupabase_('production', prod); postSupabase_('ageing', age); postSupabase_('ready', ready);
    ss.toast((prod.length + age.length + ready.length) + ' demo rows pushed to Supabase.', 'Demo', 6);
  } catch (e) { ss.toast('Demo failed — ' + e.message + ' (re-run duplicates bundle nos)', 'Error', 12); }
}

function custLookup_(ss, name) {
  if (!name) return '';
  name = String(name).trim().toLowerCase();
  var cm = ss.getSheetByName('Customer Master');
  var v = cm.getRange(2, 1, Math.max(cm.getLastRow() - 1, 1), 2).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][1]).trim().toLowerCase() === name) return v[i][0];
  return '';
}
function websterResult_(s) {
  var parts = String(s).split(/[,\s]+/).filter(String), min = 999;
  parts.forEach(function (x) { var n = parseFloat(x); if (!isNaN(n) && n < min) min = n; });
  return parts.length ? (min >= WEBSTER_MIN ? 'Pass' : 'Re-age') : '';
}
function pad_(n) { return ('0000' + n).slice(-4); }
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy'); }
function nowTime_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm'); }

/* ============================ WORKBOOK SETUP ============================= */

function setupWorkbook() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.rename('RAC Dispatch System');
  var first = ss.getSheets()[0];
  first.setName('Customer Master');
  styleRow_(first, 1, first.getLastColumn());

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
    styleRow_(sh, 1, SCHEMA[name].length);
  });
  Object.keys(ENTRY).forEach(function (name) { buildEntry_(ss, name, ENTRY[name]); });

  addValidations_(ss);
  ['Customer Master', 'Ageing Entry', 'Packing Entry', 'Production Entry',
   'Orders', 'Ageing', 'Ready', 'Production', 'Dispatch', 'Report']
    .forEach(function (n, i) { var s = ss.getSheetByName(n); if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); } });
  ss.setActiveSheet(ss.getSheetByName('Ageing Entry'));
  ss.toast('Ready. Type into the Entry tabs, tick A1 to submit.', 'Done', 8);
}

function buildEntry_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange('A1').insertCheckboxes().setValue(false);
  sh.getRange('B1').setValue('  ◀  tick to submit & clear the rows below')
    .setFontColor(BRAND_GREEN).setFontWeight('bold');
  sh.getRange(2, 1, 1, headers.length).setValues([headers]);
  styleRow_(sh, 2, headers.length);
  sh.setFrozenRows(2);
  sh.autoResizeColumns(1, headers.length);
}

function styleRow_(sh, row, nCols) {
  sh.getRange(row, 1, 1, nCols).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground(BRAND_GREEN).setHorizontalAlignment('center');
  if (row === 1) sh.setFrozenRows(1);
  sh.autoResizeColumns(1, nCols);
}

function addValidations_(ss) {
  var cust = ss.getSheetByName('Customer Master');
  var n = Math.max(cust.getLastRow() - 1, 1);
  var nameRule = SpreadsheetApp.newDataValidation().requireValueInRange(cust.getRange(2, 2, n, 1), true).setAllowInvalid(true).build();
  var shift = listRule_(['A', 'B', 'C']);
  var press = listRule_(['900-A', '900-B', '1100-A', '1100-B', '1800']);
  var alloy = listRule_(['HE9', '6061', '6063', 'HARD', 'SPL']);
  var finish = listRule_(['Mill', 'Powder coat', 'Anodise']);

  entryCol_(ss, 'Ageing Entry', 1, shift);
  entryCol_(ss, 'Ageing Entry', 4, nameRule);
  entryCol_(ss, 'Ageing Entry', 8, finish);
  entryCol_(ss, 'Packing Entry', 7, nameRule);
  entryCol_(ss, 'Production Entry', 1, shift);
  entryCol_(ss, 'Production Entry', 2, press);
  entryCol_(ss, 'Production Entry', 5, alloy);
  entryCol_(ss, 'Production Entry', 9, nameRule);
}
function listRule_(arr) { return SpreadsheetApp.newDataValidation().requireValueInList(arr, true).build(); }
function entryCol_(ss, sheet, col, rule) { ss.getSheetByName(sheet).getRange(3, col, 1000, 1).setDataValidation(rule); }

/* ============================== ORDER IMPORT ============================= */

function importOrders() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orders = ss.getSheetByName('Orders');
  if (!orders) { ui.alert('Run "1. Set up workbook" first.'); return; }
  var cm = ss.getSheetByName('Customer Master').getDataRange().getValues();
  var nameToId = {};
  for (var i = 1; i < cm.length; i++) if (cm[i][1]) nameToId[norm_(cm[i][1])] = cm[i][0];

  var src = SpreadsheetApp.openById(OLD_ORDER_LIST_ID).getSheets()[0];
  var nc = Math.max(2, Math.min(13, src.getLastColumn()));
  var maxRows = Math.min(src.getLastRow(), 6000);
  var grid = src.getRange(1, 1, maxRows, nc).getValues();
  var out = [], counts = {}, unknown = {}, skipped = 0, seq = 0, curName = '', curId = '';
  for (var r = 0; r < grid.length; r++) {
    var cells = grid[r].map(function (v) { return (v === null || v === undefined) ? '' : String(v).trim(); });
    if (cells.join('') === '') continue;
    var hdr = headerName_(cells, nameToId);
    if (hdr) { curName = hdr; curId = nameToId[norm_(hdr)] || ''; if (!curId) unknown[hdr] = true; continue; }
    if (!curName) continue;
    var o = parseOrderRow_(cells);
    if (!o) { skipped++; continue; }
    seq++;
    out.push(['O' + ('0000' + seq).slice(-4), curId, curName, o.sec, o.profile, o.len, o.qty, o.unit, o.po, o.date, o.alloy, o.price, 'Open', '']);
    counts[curName] = (counts[curName] || 0) + 1;
  }
  if (orders.getLastRow() > 1) orders.getRange(2, 1, orders.getLastRow() - 1, 14).clearContent();
  if (out.length) orders.getRange(2, 1, out.length, 14).setValues(out);
  var msg = 'Imported ' + out.length + ' order lines.\n';
  Object.keys(counts).sort().forEach(function (k) { msg += '   ' + k + ': ' + counts[k] + '\n'; });
  ui.alert(msg);
}

function importCustomerPhones() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = SpreadsheetApp.openById(OLD_ORDER_LIST_ID);
  var tries = ['customer phones', 'Customer Phones', 'customer phone', 'customer number'];
  var tab = null;
  for (var i = 0; i < tries.length; i++) { tab = src.getSheetByName(tries[i]); if (tab) break; }
  if (!tab) { ui.alert('No tab found. Tabs: ' + src.getSheets().map(function (s) { return s.getName(); }).join(', ')); return; }
  var lr = Math.min(tab.getLastRow(), 1500), lc = Math.min(Math.max(tab.getLastColumn(), 1), 12);
  var vals = tab.getRange(1, 1, lr, lc).getValues();
  var dest = ss.getSheetByName('Customer Phones') || ss.insertSheet('Customer Phones');
  dest.clear();
  if (vals.length) dest.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
  styleRow_(dest, 1, vals[0] ? vals[0].length : 1);
  ui.alert('Customer Phones: ' + vals.length + ' rows.');
}

/* ============================== HELPERS ================================== */

function headerName_(cells, nameToId) {
  if (cells[0] && nameToId[norm_(cells[0])]) return cells[0];
  if (cells[1] && nameToId[norm_(cells[1])]) return cells[1];
  var nonEmpty = cells.filter(function (v) { return v !== ''; });
  if (nonEmpty.length <= 2) {
    var t = cells[0] || cells[1];
    if (t && t.length > 3 && isNaN(Number(t)) && !looksProfile_(t) && !/\d{3,}/.test(t) && t === t.toUpperCase()) return t;
  }
  return null;
}
function parseOrderRow_(cells) {
  var sec = '', profile = '', len = '', qty = '', unit = '', po = '', date = '', alloy = '', price = '', used = {};
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i]; if (!c) continue;
    if (!qty) { var q = asQty_(c); if (q) { qty = q.qty; unit = q.unit; used[i] = 1; continue; } }
    if (!sec && /^\d{3,4}$/.test(c)) { sec = c; used[i] = 1; continue; }
    if (!alloy && isAlloy_(c)) { alloy = c; used[i] = 1; continue; }
    if (!len && isLen_(c)) { len = c; used[i] = 1; continue; }
    if (!po && isPO_(c)) { po = c; used[i] = 1; continue; }
    if (!date && isDate_(c)) { date = c; used[i] = 1; continue; }
  }
  for (var j = 0; j < cells.length; j++) { if (used[j]) continue; if (cells[j] && looksProfile_(cells[j])) { profile = cells[j]; used[j] = 1; break; } }
  for (var k = cells.length - 1; k >= 0; k--) { if (used[k]) continue; if (cells[k]) { price = cells[k]; break; } }
  if ((sec || profile) && (qty || len)) return { sec: sec, profile: profile, len: len, qty: qty, unit: unit, po: po, date: date, alloy: alloy, price: price };
  return null;
}
function norm_(s) { return String(s).toUpperCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim(); }
function asQty_(c) { var m = c.match(/^([\d.,]+)\s*(KGS?|PCS?|PS|PC)\b/i); if (m) return { qty: m[1].replace(/,/g, ''), unit: /K/i.test(m[2]) ? 'Kg' : 'Pcs' }; return null; }
function isLen_(c) { return /^\d{1,2}'$/.test(c) || /^\d{1,2}$/.test(c) || /^\d{3,5}\s*MM$/i.test(c) || /^\d{2,4}["']{1,2}$/.test(c); }
function isAlloy_(c) { return /^(HE\s?9\.?|6061|6063|HARD|SPL|63400)$/i.test(c) || /^NALCO/i.test(c); }
function isPO_(c) { return /^(PO\b|Po No|PO No)/i.test(c) || /^\d{7,}$/.test(c); }
function isDate_(c) { return /^\d{1,2}[-\/]\d{1,2}([-\/]\d{2,4})?$/.test(c); }
function looksProfile_(c) {
  if (/^(HE9|6061|6063|HARD|SPL|NALCO|OK|PO|STOCK)/i.test(c)) return false;
  return /[A-Za-z]/.test(c) && (/[*xX]/.test(c) || /(RT|RP|SQ|FLAT|ANGLE|PIPE|ROD|TUBE|CW|DV|DTD|DTS|DMD|CLIP|PLATE|CHANNEL|LOUVER|TEE|STR|FRP|SC|RDT|GGC|LADDER|SECTION|HANDLE|INTERLOCK|TRACK|COVER|PRESSURE|GLAZING|BEAD)/i.test(c));
}

// Optional helper for Upload -> Manual production report photos.
// Requires Apps Script Advanced Google service: Drive API.
function ocrProductionReportImage(payload) {
  try {
    if (!payload || !payload.data) return { ok:false, error:'No image data received.' };
    if (typeof Drive === 'undefined' || !Drive.Files) {
      return { ok:false, error:'Enable Advanced Google service "Drive API" in this Apps Script project, then deploy again.' };
    }
    var name = payload.name || ('production_report_' + new Date().getTime() + '.jpg');
    var mime = payload.mimeType || 'image/jpeg';
    var blob = Utilities.newBlob(Utilities.base64Decode(payload.data), mime, name);
    var file;
    if (Drive.Files.insert) {
      file = Drive.Files.insert(
        { title:'OCR ' + name, mimeType:MimeType.GOOGLE_DOCS },
        blob,
        { ocr:true, ocrLanguage:'en' }
      );
    } else if (Drive.Files.create) {
      file = Drive.Files.create(
        { name:'OCR ' + name, mimeType:MimeType.GOOGLE_DOCS },
        blob,
        { fields:'id' }
      );
    } else {
      return { ok:false, error:'Drive API is enabled, but neither Files.insert nor Files.create is available.' };
    }
    var text = DocumentApp.openById(file.id).getBody().getText();
    try { Drive.Files.remove(file.id); } catch (cleanupErr) {}
    return { ok:true, text:text || '' };
  } catch (err) {
    return { ok:false, error:err && err.message ? err.message : String(err) };
  }
}

function authorizeOcrOnce() {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw new Error('Enable Advanced Google service "Drive API" first.');
  }
  var blob = Utilities.newBlob('RAC OCR permission check', 'text/plain', 'rac_ocr_permission_check.txt');
  var file;
  if (Drive.Files.insert) {
    file = Drive.Files.insert(
      { title:'RAC OCR permission check', mimeType:MimeType.GOOGLE_DOCS },
      blob,
      { ocr:true, ocrLanguage:'en' }
    );
  } else if (Drive.Files.create) {
    file = Drive.Files.create(
      { name:'RAC OCR permission check', mimeType:MimeType.GOOGLE_DOCS },
      blob,
      { fields:'id' }
    );
  } else {
    throw new Error('Drive API is enabled, but neither Files.insert nor Files.create is available.');
  }
  try { Drive.Files.remove(file.id); } catch (cleanupErr) {}
  return 'OCR permissions OK';
}
