/**
 * RAC Die Inventory - Google Sheet Generator
 *
 * Run createDieEntrySheet() once from Apps Script editor.
 * Creates a formatted Google Sheet for daily die cataloguing
 * with data validation, dropdowns, and a reference tab.
 *
 * After running:
 *   1. Open the sheet (URL logged in execution log)
 *   2. File -> Share -> Publish to web -> select "Die Entry" tab -> CSV -> Publish
 *   3. Copy the published CSV URL and share with Claude
 */

function createDieEntrySheet() {
  var ss = SpreadsheetApp.create('RAC Die Inventory - Daily Entry');
  var entrySheet = ss.getSheets()[0].setName('Die Entry');

  setupReferenceSheet_(ss);
  setupEntrySheet_(entrySheet, ss);
  setupDailyLogSheet_(ss);

  Logger.log('Sheet created: ' + ss.getUrl());
  SpreadsheetApp.getUi().alert('Sheet created!\n\n' + ss.getUrl());
}


function setupEntrySheet_(sheet, ss) {
  var headers = [
    'entry_date',           // 1
    'section_no',           // 2
    'die_sequence',         // 3
    'container_size_inch',  // 4
    'die_od_mm',            // 5
    'die_thickness_mm',     // 6  (NEW - die size = OD x thickness)
    'current_running_wt',   // 7  (NEW - kg/m the die produces now)
    'die_type',             // 8
    'num_cavities',         // 9
    'customer_name',        // 10 (dropdown = names)
    'customer_code',        // 11 (auto from name)
    'current_status',       // 12
    'current_location',     // 13
    'die_maker',            // 14
    'made_date',            // 15
    'make_cost_inr',        // 16
    'photo_link',           // 17
    'notes',                // 18
    'entered_by'            // 19
  ];

  var descriptions = [
    'YYYY-MM-DD',
    'Section number from die marking',
    '01, 02, 03... for multiple dies of same section',
    '5 or 7',
    'Die outer diameter in mm (e.g. 190, 220)',
    'Die thickness in mm (e.g. 110, 140) - die size = OD x thickness',
    'Current running weight the die produces (kg/m)',
    'Solid / Hollow / Semi-hollow / Porthole',
    'Number of cavities (default 1)',
    'Pick customer name from the dropdown',
    'Auto-filled from the name',
    'Idle / Active / Retired / Scrapped / Missing',
    'Rack code (DR-A-01) or press (ON_P1) or other',
    'Die manufacturer name',
    'YYYY-MM-DD (from records)',
    'Cost in Rs  (from records)',
    'Physical die photo (optional; profile drawings auto-linked from section no)',
    'Any observations',
    'Name of person recording'
  ];

  // Headers in row 1
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  // Description hints in row 2
  sheet.getRange(2, 1, 1, descriptions.length).setValues([descriptions]);

  // Example row
  var example = [
    '2026-07-30', '8087', '01', 5, 190, 110, 1.85, 'Hollow', 2,
    'Axsys', 'A016', 'Idle', 'DR-A-01',
    'XYZ Dies', '2024-03-15', 45000, '', 'Good condition', 'Raju'
  ];
  sheet.getRange(3, 1, 1, example.length).setValues([example]);

  // Formatting
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold')
    .setBackground('#2d5016')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  var descRange = sheet.getRange(2, 1, 1, headers.length);
  descRange.setFontStyle('italic')
    .setFontSize(9)
    .setFontColor('#666666')
    .setBackground('#f0f0f0')
    .setWrap(true);

  sheet.setFrozenRows(2);

  // Column widths (19 columns)
  var widths = [100, 90, 90, 110, 90, 100, 130, 110, 90, 150, 100, 100, 110, 110, 100, 100, 180, 200, 100];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  var refSheet = ss.getSheetByName('Reference');
  var maxRow = 1000;

  // container_size_inch (col 4): 5 or 7
  var containerRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([5, 7], true)
    .setAllowInvalid(false)
    .setHelpText('5-inch or 7-inch press container')
    .build();
  sheet.getRange(3, 4, maxRow, 1).setDataValidation(containerRule);

  // die_type (col 8)
  var typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Solid', 'Hollow', 'Semi-hollow', 'Porthole'], true)
    .setAllowInvalid(false)
    .setHelpText('Die profile type')
    .build();
  sheet.getRange(3, 8, maxRow, 1).setDataValidation(typeRule);

  // num_cavities (col 9): 1-12
  var cavRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 12)
    .setAllowInvalid(false)
    .setHelpText('1-12 cavities')
    .build();
  sheet.getRange(3, 9, maxRow, 1).setDataValidation(cavRule);

  // customer_name (col 10) - dropdown of NAMES from Reference tab (col E)
  var custRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(refSheet.getRange('E2:E120'), true)
    .setAllowInvalid(true)
    .setHelpText('Pick a customer name (type to search)')
    .build();
  sheet.getRange(3, 10, maxRow, 1).setDataValidation(custRule);

  // customer_code (col 11) - auto from the chosen name (reverse lookup name -> code)
  for (var r = 3; r <= 20; r++) {
    sheet.getRange(r, 11).setFormula(
      '=IF(J' + r + '="","",IFERROR(INDEX(Reference!D:D,MATCH(J' + r + ',Reference!E:E,0)),"Unknown"))'
    );
  }

  // current_status (col 12)
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Active', 'Idle', 'Retired', 'Scrapped', 'Missing'], true)
    .setAllowInvalid(false)
    .setHelpText('Current die status')
    .build();
  sheet.getRange(3, 12, maxRow, 1).setDataValidation(statusRule);

  // current_location (col 13) - from Reference tab
  var locRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(refSheet.getRange('A2:A50'), true)
    .setAllowInvalid(true)
    .setHelpText('Select from known locations or type a new rack code')
    .build();
  sheet.getRange(3, 13, maxRow, 1).setDataValidation(locRule);

  // Conditional formatting - highlight missing required fields
  var requiredCols = [2, 4, 5, 10, 12, 13]; // section_no, container, od, customer_name, status, location
  for (var c = 0; c < requiredCols.length; c++) {
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenCellEmpty()
      .setBackground('#fff3cd')
      .setRanges([sheet.getRange(3, requiredCols[c], maxRow, 1)])
      .build();
    sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().concat([rule]));
  }

  // Number formats
  sheet.getRange(3, 1, maxRow, 1).setNumberFormat('yyyy-mm-dd');   // entry_date
  sheet.getRange(3, 7, maxRow, 1).setNumberFormat('0.000');        // current_running_wt
  sheet.getRange(3, 15, maxRow, 1).setNumberFormat('yyyy-mm-dd');  // made_date
  sheet.getRange(3, 16, maxRow, 1).setNumberFormat('#,##0');       // make_cost_inr

  // Protect description row
  var protection = sheet.getRange(2, 1, 1, headers.length).protect();
  protection.setDescription('Field descriptions - do not edit');
  protection.setWarningOnly(true);
}


function setupReferenceSheet_(ss) {
  var ref = ss.insertSheet('Reference');

  // Location codes
  ref.getRange(1, 1).setValue('Location Code').setFontWeight('bold');
  ref.getRange(1, 2).setValue('Description').setFontWeight('bold');
  var locations = [
    ['ON_P1', 'Press 1 (5-inch)'],
    ['ON_P2', 'Press 2 (5-inch)'],
    ['ON_P4', 'Press 4 (5-inch)'],
    ['ON_P5', 'Press 5 (7-inch)'],
    ['ON_P6', 'Press 6 (5-inch)'],
    ['NITRIDING_VENDOR', 'At nitriding vendor'],
    ['CORRECTION_SHOP', 'At correction shop'],
    ['SCRAP', 'Scrap yard'],
    ['MISSING', 'Unaccounted for'],
    ['DR-A-01', 'Die Room Rack A-01'],
    ['DR-A-02', 'Die Room Rack A-02'],
    ['DR-A-03', 'Die Room Rack A-03'],
    ['DR-B-01', 'Die Room Rack B-01'],
    ['DR-B-02', 'Die Room Rack B-02'],
    ['DR-B-03', 'Die Room Rack B-03'],
    ['DR-C-01', 'Die Room Rack C-01'],
    ['DR-C-02', 'Die Room Rack C-02'],
    ['DR-C-03', 'Die Room Rack C-03']
  ];
  ref.getRange(2, 1, locations.length, 2).setValues(locations);

  // Customer codes (col D-E)
  ref.getRange(1, 4).setValue('Customer Code').setFontWeight('bold');
  ref.getRange(1, 5).setValue('Customer Name').setFontWeight('bold');

  var customers = [
    ['A001','Aaradhya'],['A002','AASTHA'],['A003','Aastha Equipments'],
    ['A004','Able Anodizer'],['A005','Ace Enterprises'],['A006','ADHUNIK METAL'],
    ['A007','AIR CARE ENGINEERS'],['A008','Airtouch'],['A009','ALL HOME'],
    ['A010','ALLIED LADER'],['A011','Alum X System'],['A012','ANAND TRACK'],
    ['A013','Arora Metal'],['A014','ARVIND ARORA'],['A015','AUTO TECH'],
    ['A016','Axsys'],['B001','Bachitter Singh'],['B002','BAJRANG INDUSTRIES'],
    ['B003','BHARTH ALU'],['B004','BOMBAY METALS'],['B005','BUDDING'],
    ['C001','CARDEL HEALTHCARE'],['C002','Cardel Ranchi'],['C003','Ceiling Expert'],
    ['C004','CHEMPHARMA'],['C005','Chirag'],['C006','Classic'],
    ['C007','Classic Steel'],['C008','COSMOS MEDIA'],['C009','BHAJANPURA'],
    ['D001','Divek Alu Glazing'],['E001','EM KAY LINKS CORPORATION'],['E002','ERSS'],
    ['E003','EXTREO RAILING'],['F001','Faalcon c/o FNG'],['F002','FACTORY'],
    ['F003','Fraction Kitchen'],['G001','GOPAL JI'],['G002','GRD'],
    ['G003','GREEN FENESTRATION'],['G004','Gupta Metal Mesh'],['G005','GYGY'],
    ['H001','Hospidecor'],['I001','INALCO METAL'],['I002','India Metals'],
    ['I003','Inovic'],['J001','J R ALUMINIUM LLP'],['K001','K2 SCAFFOLD P LTD'],
    ['K002','Kainath'],['K003','KEPL C/o Mech Mark'],['K004','KOHLI ALU'],
    ['K005','KEPL'],['L001','LIFELINE'],['L002','Luthra'],
    ['M001','M U TRADERS'],['M002','Madhvi'],['M003','MALHOTRA SONS'],
    ['M004','MASS INTERIOR'],['M005','Mediind'],['M006','Mediline'],
    ['M007','Medimax Hospital'],['M008','Metal Expert'],['M009','MITTAL METALLOYS'],
    ['M010','Mohanshree'],['N001','Naamdhari'],['N002','Nature Green'],
    ['N003','NEW'],['N004','NORDLYS'],['O001','OM GLOBAL'],
    ['O002','OXYGEN HOSPITAL'],['P001','Padmavati'],['P002','PANKAJ ALU'],
    ['P003','Paragon'],['P004','PERFECT SOLUTIONS'],['P005','Prixcart'],
    ['R001','RADHIKA KITCHEN'],['R002','RAM AVTAR &CO'],['R003','Rishabh International'],
    ['R005','Royal Infra'],['R006','RS Electronics'],['S001','S P Aluminium Motor'],
    ['S002','S S CREATIVE'],['S003','Saffido'],['S004','SAGAR ENT'],
    ['S005','SAHIL GRAPHIC'],['S006','Sanish Prl'],['S007','SBG'],
    ['S008','SDC'],['S009','SETHI ALUMINIUM'],['S010','SHAKAMBHARI ISPAT &POWER LTD'],
    ['S011','SHANKER GLASS'],['S012','Sheesh Mahal'],['S013','SHREE LAL'],
    ['S014','SHYAM LADER'],['S015','SHYAM TRADING'],['S016','SILICA Global'],
    ['S017','SK Industries'],['S018','Solution Sahab'],['S019','SR'],
    ['S020','Srinath & Co'],['S021','SWASTIK ALU'],['S022','Swiss Auto'],
    ['T001','TechnoPack'],['T002','TRIMURTI'],['T003','TRUE AIR'],
    ['U001','Unicare'],['U002','UNICARE FIRE SAFETY INDIA P LTD'],
    ['V001','VEDAANT'],['V002','Vimal Metal'],['W001','WHITE METAL']
  ];
  ref.getRange(2, 4, customers.length, 2).setValues(customers);

  // Die types (col G)
  ref.getRange(1, 7).setValue('Die Types').setFontWeight('bold');
  var types = [['Solid'],['Hollow'],['Semi-hollow'],['Porthole']];
  ref.getRange(2, 7, types.length, 1).setValues(types);

  // Statuses (col H)
  ref.getRange(1, 8).setValue('Statuses').setFontWeight('bold');
  var statuses = [['Active'],['Idle'],['Retired'],['Scrapped'],['Missing']];
  ref.getRange(2, 8, statuses.length, 1).setValues(statuses);

  ref.setColumnWidth(1, 140);
  ref.setColumnWidth(2, 180);
  ref.setColumnWidth(4, 110);
  ref.setColumnWidth(5, 180);
  ref.setColumnWidth(7, 110);
  ref.setColumnWidth(8, 100);

  // Header formatting
  ref.getRange(1, 1, 1, 8).setBackground('#2d5016').setFontColor('#ffffff');

  // Note
  ref.getRange(locations.length + 3, 1).setValue(
    'Add new rack codes here as you finalize die room layout. Location dropdown on Die Entry tab pulls from column A.'
  ).setFontStyle('italic').setFontColor('#888888');
}


function setupDailyLogSheet_(ss) {
  var log = ss.insertSheet('Import Log');

  var headers = ['import_date', 'rows_imported', 'rows_skipped', 'errors', 'imported_by'];
  log.getRange(1, 1, 1, headers.length).setValues([headers]);
  log.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#2d5016')
    .setFontColor('#ffffff');

  log.setFrozenRows(1);
  log.getRange(1, 1, 1, 1).setNote(
    'This tab tracks each time data is fetched from this sheet into Supabase. ' +
    'Claude fills this automatically after each import run.'
  );
}


/**
 * Utility: returns all Die Entry data as JSON (for testing / manual export).
 * Not needed for the publish-to-web CSV flow, but useful if you want
 * an Apps Script web app endpoint later.
 */
function getDieEntryData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Die Entry');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];
  // Skip header (row 0) and description (row 1)
  for (var i = 2; i < data.length; i++) {
    if (!data[i][1] && !data[i][4]) continue; // skip empty rows (no section_no AND no die_od)
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return rows;
}
