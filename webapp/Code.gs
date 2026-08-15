/**
 * RAC DISPATCH - web app host (Apps Script just serves the page; all data goes
 * browser -> Supabase directly, so there's no per-action macro lag).
 *
 * SETUP:
 *   script.google.com -> New project
 *   - paste this into Code.gs
 *   - "+" -> HTML -> name it exactly  Index  -> paste Index.html
 *   - "+" -> HTML -> name it exactly  Supervisor  -> paste Supervisor.html
 *   - Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone -> Deploy
 *   - open the Web app URL
 *
 * SUPERVISOR PORTAL:
 *   {deployment_url}?page=supervisor
 *   Mobile-first photo OCR — supervisors snap a report photo, AI reads it,
 *   data lands in production. Share this URL with supervisors to bookmark.
 */
function doGet(e) {
  e = e || {};
  if (e.parameter && e.parameter.doc) { return serveSharedDoc_(e.parameter.doc); }   // customer-facing list link
  if (e.parameter && e.parameter.page === 'supervisor') {
    return HtmlService.createHtmlOutputFromFile('Supervisor')
      .setTitle('RAC Supervisor')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('RAC Dispatch')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Supabase creds shared by the server-side helpers below ──
var SB_URL_ = 'https://qhvtrlktxfnvuijokkds.supabase.co';
var SB_KEY_ = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFodnRybGt0eGZudnVpam9ra2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ5MDMsImV4cCI6MjA5Njg1MDkwM30.4QnrUEhuLJOoNccZCzYtSQfBdDjxOTDtnadzVMY06do';

// Render a saved list (packing list / stock list) as a standalone page for the WhatsApp link.
function serveSharedDoc_(token) {
  try {
    var res = UrlFetchApp.fetch(SB_URL_ + '/rest/v1/shared_docs?token=eq.' + encodeURIComponent(token) + '&select=html,label', {
      headers: { apikey: SB_KEY_, Authorization: 'Bearer ' + SB_KEY_ }, muteHttpExceptions: true
    });
    var arr = JSON.parse(res.getContentText() || '[]');
    if (!arr.length) return HtmlService.createHtmlOutput('<p style="font-family:Arial;padding:24px">This list link is invalid or has expired.</p>').setTitle('RAC Extrusions');
    return HtmlService.createHtmlOutput(arr[0].html)
      .setTitle('RAC Extrusions - ' + (arr[0].label || 'List'))
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput('<p style="font-family:Arial;padding:24px">Could not load this list.</p>').setTitle('RAC Extrusions');
  }
}

/**
 * ONE-TIME: pull profile pictures from the order-list "drawings" tab into the
 * Supabase `sections` table. Run this function (Run -> importDrawings), then
 * open View -> Execution log and paste the output back.
 */
function importDrawings() {
  var ORDER_ID = '1e1uNLfKTWS0OLEl0IQ6tlBDi2ovhUeuevm53HLCI6xQ';
  var SB_URL = 'https://qhvtrlktxfnvuijokkds.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFodnRybGt0eGZudnVpam9ra2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ5MDMsImV4cCI6MjA5Njg1MDkwM30.4QnrUEhuLJOoNccZCzYtSQfBdDjxOTDtnadzVMY06do';
  var src = SpreadsheetApp.openById(ORDER_ID), sh = null, names = ['drawings','Drawings','DRAWINGS','Drawing'];
  for (var i = 0; i < names.length; i++) { sh = src.getSheetByName(names[i]); if (sh) break; }
  if (!sh) { Logger.log('No drawings tab. Tabs: ' + src.getSheets().map(function (s) { return s.getName(); }).join(', ')); return; }
  var lr = Math.min(sh.getLastRow(), 3000), lc = Math.min(Math.max(sh.getLastColumn(), 1), 15);
  var vals = sh.getRange(1, 1, lr, lc).getValues(), forms = sh.getRange(1, 1, lr, lc).getFormulas();
  var imgByRow = {}, imgCount = 0, imgNoUrl = 0, cellImgCount = 0, cellImgNoUrl = 0;
  try { var imgs = sh.getImages(); imgCount = imgs.length; imgs.forEach(function (im) { var u = null; try { u = im.getUrl(); } catch (e) {} var rr = im.getAnchorCell().getRow(); if (u) imgByRow[rr] = u; else imgNoUrl++; }); } catch (e) {}
  var out = [], seen = {};
  for (var r = 0; r < lr; r++) {
    var url = '';
    for (var c = 0; c < lc; c++) { var f = forms[r][c] || ''; var m = f.match(/IMAGE\(\s*["']([^"']+)["']/i); if (m) { url = m[1]; break; } }
    if (!url) { for (var c1 = 0; c1 < lc; c1++) { var v = ('' + (vals[r][c1] || '')).trim(); if (/^https?:\/\//.test(v)) { url = v; break; } } }
    if (!url && imgByRow[r + 1]) { url = imgByRow[r + 1]; }
    if (!url) { for (var ci = 0; ci < lc; ci++) { var cv = vals[r][ci]; if (cv && typeof cv === 'object' && typeof cv.getContentUrl === 'function') { cellImgCount++; var cu = null; try { cu = cv.getUrl(); } catch (e) {} if (cu) { url = cu; break; } else { cellImgNoUrl++; } } } }
    if (!url) continue;
    var sec = '';
    for (var c2 = 0; c2 < lc; c2++) { var v2 = ('' + (vals[r][c2] || '')).trim(); if (/^\d{2,6}$/.test(v2)) { sec = v2; break; } }
    if (!sec) { var v0 = ('' + (vals[r][0] || '')).trim(); if (v0 && !/^https?:/.test(v0)) sec = v0; }
    if (!sec || seen[sec]) continue; seen[sec] = 1;
    var nm = '';
    for (var c3 = 0; c3 < lc; c3++) { var v3 = ('' + (vals[r][c3] || '')).trim(); if (v3 && v3 !== sec && !/^https?:/.test(v3) && !/^\d+$/.test(v3)) { nm = v3; break; } }
    out.push({ section_no: sec, section_name: nm || null, image_url: url });
  }
  if (out.length) {
    var res = UrlFetchApp.fetch(SB_URL + '/rest/v1/sections?on_conflict=section_no', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(out), muteHttpExceptions: true
    });
    Logger.log('Supabase: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 150));
  }
  Logger.log('Scanned ' + lr + ' rows. Found ' + out.length + ' section+image pairs. Over-grid images: ' + imgCount + ' (no URL: ' + imgNoUrl + '). In-cell images: ' + cellImgCount + ' (no source URL: ' + cellImgNoUrl + ').');
  Logger.log('Sample: ' + JSON.stringify(out.slice(0, 3)));
}

/**
 * ONE-TIME (re-runnable): pull profile images from a Google Drive FOLDER whose
 * files are NAMED BY SECTION NUMBER (e.g. 8124.png) into the Supabase `sections`
 * table. Run this (Run -> importSectionImages), then paste the Execution log.
 *
 * IMPORTANT: the floor app loads these images WITHOUT a Google login, so the
 * folder must be shared "Anyone with the link - Viewer" or the pictures 404.
 * Set that once: right-click the folder in Drive -> Share -> General access ->
 * Anyone with the link -> Viewer. (Files inherit it.)
 */
function importSectionImages() {
  var FOLDER_ID = '18eHbXsAgwbfRiEFLyiWC1uMCj5L1Arrg';
  var SB_URL = 'https://qhvtrlktxfnvuijokkds.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFodnRybGt0eGZudnVpam9ra2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ5MDMsImV4cCI6MjA5Njg1MDkwM30.4QnrUEhuLJOoNccZCzYtSQfBdDjxOTDtnadzVMY06do';
  var folder;
  try { folder = DriveApp.getFolderById(FOLDER_ID); }
  catch (e) { Logger.log('Cannot open folder: ' + e.message); return; }
  var files = folder.getFiles(), bySec = {}, scanned = 0, skipped = 0, dupes = 0;
  while (files.hasNext()) {
    var f = files.next();
    var mt = (f.getMimeType() || '');
    if (mt.indexOf('image/') !== 0) { continue; }
    scanned++;
    var sec = f.getName().replace(/\.[^.]+$/, '').trim();   // filename minus extension = section no
    if (!sec) { skipped++; continue; }
    if (bySec[sec]) { dupes++; }                            // same section no seen twice -> last wins, no in-batch collision
    bySec[sec] = { section_no: sec, image_url: 'https://lh3.googleusercontent.com/d/' + f.getId() + '=w240' };  // direct image (no 302 redirect)
  }
  var out = Object.keys(bySec).map(function (k) { return bySec[k]; });
  for (var i = 0; i < out.length; i += 200) {
    var chunk = out.slice(i, i + 200);
    var res = UrlFetchApp.fetch(SB_URL + '/rest/v1/sections?on_conflict=section_no', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(chunk), muteHttpExceptions: true
    });
    Logger.log('Chunk ' + (Math.floor(i / 200) + 1) + ': HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
  }
  Logger.log('Scanned ' + scanned + ' images -> ' + out.length + ' unique sections imported (' + dupes + ' duplicate filenames collapsed, ' + skipped + ' unnamed). Reminder: set the Drive folder to "Anyone with the link - Viewer".');
}

/**
 * ONE-TIME (re-runnable): pull section drawing PDFs from a Drive FOLDER whose
 * files are NAMED BY SECTION NUMBER (e.g. 8124.pdf) into sections.pdf_url.
 * The folder MUST be shared "Anyone with the link - Viewer" or the drawing 404s
 * when a supervisor (not logged into Google) clicks it.
 * Run -> importSectionPdfs, then paste the Execution log.
 */
function importSectionPdfs() {
  var FOLDER_ID = '1v41tbv08sBRvaenLx_iSXvWfZChS0aIM';
  var folder;
  try { folder = DriveApp.getFolderById(FOLDER_ID); }
  catch (e) { Logger.log('Cannot open folder: ' + e.message); return; }
  var bySec = {}, stat = { scanned: 0, skipped: 0, dupes: 0, folders: 0 };
  walkPdfs_(folder, bySec, stat);   // recurse: the "SEC NO" folder nests PDFs in range subfolders
  var out = Object.keys(bySec).map(function (k) { return bySec[k]; });
  for (var i = 0; i < out.length; i += 200) {
    var chunk = out.slice(i, i + 200);
    var res = UrlFetchApp.fetch(SB_URL_ + '/rest/v1/sections?on_conflict=section_no', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: SB_KEY_, Authorization: 'Bearer ' + SB_KEY_, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(chunk), muteHttpExceptions: true
    });
    Logger.log('Chunk ' + (Math.floor(i / 200) + 1) + ': HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
  }
  Logger.log('Walked ' + stat.folders + ' folders, ' + stat.scanned + ' PDFs -> ' + out.length + ' unique sections linked (' + stat.dupes + ' dup filenames, ' + stat.skipped + ' unnamed). Set the folder to "Anyone with the link - Viewer".');
}

// Recursively collect PDFs (named by section no) from a folder and all its subfolders.
function walkPdfs_(folder, bySec, stat) {
  stat.folders++;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if ((f.getMimeType() || '').indexOf('pdf') < 0) { continue; }
    stat.scanned++;
    var sec = f.getName().replace(/\.[^.]+$/, '').trim();
    if (!sec) { stat.skipped++; continue; }
    if (bySec[sec]) { stat.dupes++; }
    bySec[sec] = { section_no: sec, pdf_url: 'https://drive.google.com/file/d/' + f.getId() + '/view' };
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) { walkPdfs_(subs.next(), bySec, stat); }
}

// ════════════════════════════════════════════════════════════════════════
//  WhatsApp — send a customer a LINK to a packing / stock list.
//  Reuses the proven helloall (Meta v19) gateway + order_status template.
//  REQUIRED Script Properties in THIS project (Project Settings -> Script Properties),
//  copy them from the furnace ERP project: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN.
//  Optional: WA_TEMPLATE_NAME (default order_status), WA_TEMPLATE_LANG (default en).
// ════════════════════════════════════════════════════════════════════════
function waProps_() {
  var p = PropertiesService.getScriptProperties();
  return { phoneId: p.getProperty('WA_PHONE_NUMBER_ID'), token: p.getProperty('WA_ACCESS_TOKEN'),
           tmpl: p.getProperty('WA_TEMPLATE_NAME') || 'order_status', lang: p.getProperty('WA_TEMPLATE_LANG') || 'en' };
}
function waConfigured_() { var w = waProps_(); return !!(w.phoneId && w.token); }
function waNumber_(v) {
  if (v === '' || v == null) return '';
  var d = v.toString().replace(/[^0-9]/g, '');
  if (d.length === 10) d = '91' + d;
  else if (d.length === 11 && d.charAt(0) === '0') d = '91' + d.substring(1);
  return d;
}
function waPost_(payload) {
  var w = waProps_();
  if (!w.phoneId || !w.token) return { ok:false, error:'WhatsApp not set up: add WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in Project Settings -> Script Properties.' };
  try {
    var resp = UrlFetchApp.fetch('https://crm.helloall.in/api/meta/v19.0/' + w.phoneId + '/messages', {
      method:'post', contentType:'application/json', headers:{ Authorization:'Bearer ' + w.token },
      payload: JSON.stringify(payload), muteHttpExceptions:true });
    var code = resp.getResponseCode(), body = resp.getContentText(), parsed = null;
    try { parsed = JSON.parse(body); } catch (eP) {}
    var id = '';
    if (parsed) { if (parsed.messages && parsed.messages[0] && parsed.messages[0].id) id = parsed.messages[0].id;
                  else if (parsed.message && parsed.message.queue_id) id = parsed.message.queue_id; }
    var apiErr = (parsed && parsed.error) ? (parsed.error.message || JSON.stringify(parsed.error)) : '';
    return { ok:(code >= 200 && code < 300) && !apiErr, status:code, id:id, error:apiErr, body:(body||'').substring(0,300) };
  } catch (e) { return { ok:false, error:e.message }; }
}
function waSendTemplate_(to, name, bodyParams, langCode) {
  var num = waNumber_(to);
  if (num.length < 10) return { ok:false, error:'Invalid phone: ' + to };
  return waPost_({ to:num, recipient_type:'individual', type:'template',
    template:{ language:{ policy:'deterministic', code:(langCode || waProps_().lang) }, name:name,
      components:[{ type:'body', parameters:(bodyParams||[]).map(function(t){ return { type:'text', text:String(t) }; }) }] } });
}
// CALLED FROM THE BROWSER (google.script.run): save the list page, build a link, WhatsApp it.
function sendListWhatsApp(html, label, phone) {
  if (!waConfigured_()) return { ok:false, error:'WhatsApp not configured. Add WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in Project Settings -> Script Properties.' };
  var num = waNumber_(phone);
  if (num.length < 10) return { ok:false, error:'No valid WhatsApp number for this customer.' };
  if (!html) return { ok:false, error:'Nothing to send.' };
  var token = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  var save = UrlFetchApp.fetch(SB_URL_ + '/rest/v1/shared_docs', {
    method:'post', contentType:'application/json',
    headers:{ apikey:SB_KEY_, Authorization:'Bearer ' + SB_KEY_, Prefer:'return=minimal' },
    payload: JSON.stringify([{ token:token, html:html, label:(label||'List') }]), muteHttpExceptions:true });
  if (save.getResponseCode() >= 300) return { ok:false, error:'Could not save the list: ' + save.getContentText().substring(0,150) };
  var link = ScriptApp.getService().getUrl() + '?doc=' + token;
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy');
  var r = waSendTemplate_(num, waProps_().tmpl, [ label || 'RAC List', today, link ]);
  return { ok:r.ok, link:link, id:r.id, status:r.status, error:r.error, to:num };
}
// Editor probe — confirms creds exist without revealing them.
function waDiag() { var w = waProps_(); var o = { configured: !!(w.phoneId && w.token), template:w.tmpl, lang:w.lang }; Logger.log(JSON.stringify(o)); return o; }

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
