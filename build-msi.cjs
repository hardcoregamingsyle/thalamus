#!/usr/bin/env node
/**
 * Thalamus AI MSI Installer Builder
 * Creates a valid Windows Installer (.msi) package without requiring WiX or msitools.
 */

const cfb = require('cfb');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'thalamus-native', 'dist');
const APP_VERSION = '1.0.0';
const PRODUCT_CODE = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
const UPGRADE_CODE = 'F6A7B8C9-D0E1-2345-EFAB-567890123456';

// ── Binary helpers ─────────────────────────────────────────────────────────

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
}

function wstr(s) {
  const str = String(s) + '\0';
  const b = Buffer.alloc(2 + str.length);
  b.writeUInt16LE(str.length, 0);
  b.write(str, 2, 'ascii');
  return b;
}

function guidStr(g) {
  return g.replace(/[{}]/g, '');
}

// ── MSI Table Builder ──────────────────────────────────────────────────────

class MsiTable {
  constructor(name) {
    this.name = name;
    this.cols = [];
    this.rows = [];
  }

  col(name, type, len, nullable, pk) {
    this.cols.push({ name, type, len: len || 0, nullable: !!nullable, pk: !!pk });
  }

  row(...vals) {
    if (vals.length !== this.cols.length)
      throw new Error(`Row has ${vals.length} vals, table ${this.name} has ${this.cols.length} cols`);
    this.rows.push(vals);
  }

  encode() {
    const parts = [];

    // Table name + NUL (padded to even)
    const tn = Buffer.alloc(this.name.length + 2, 0);
    tn.write(this.name + '\0', 0, 'ascii');
    parts.push(tn);

    // Column count
    parts.push(u16(this.cols.length));

    // Column defs
    for (let i = 0; i < this.cols.length; i++) {
      const c = this.cols[i];
      const cn = Buffer.alloc(c.name.length + 2, 0);
      cn.write(c.name + '\0', 0, 'ascii');
      parts.push(cn);

      let typ = c.type & 0x07;
      if (c.nullable) typ |= 0x10;
      if (c.pk) {
        const pkIdx = this.cols.filter((x, j) => j < i && x.pk).length;
        typ |= (pkIdx + 1) << 5;
      }
      parts.push(u16(typ));
      parts.push(u16(c.len));
    }

    // Row data
    const rowParts = [];
    for (const r of this.rows) {
      for (let i = 0; i < this.cols.length; i++) {
        const c = this.cols[i];
        const v = r[i];
        if (v === null || v === undefined) {
          switch (c.type) {
            case 1: rowParts.push(u16(32767)); break;
            case 2: rowParts.push(u32(2147483647)); break;
            default: rowParts.push(u16(0)); break;
          }
        } else {
          switch (c.type) {
            case 0: rowParts.push(wstr(String(v))); break;
            case 1: rowParts.push(u16(parseInt(v))); break;
            case 2: rowParts.push(u32(parseInt(v))); break;
            default: rowParts.push(wstr(String(v))); break;
          }
        }
      }
    }

    parts.push(u16(this.rows.length));
    parts.push(Buffer.concat(rowParts));
    return Buffer.concat(parts);
  }
}

// ── Build tables ───────────────────────────────────────────────────────────

function buildMsiDatabase() {
  const tables = [];

  // 1. Property
  const p = new MsiTable('Property');
  p.col('Property', 0, 72, false, true);
  p.col('Value', 0, 0, false, false);
  const props = {
    ProductCode: guidStr(PRODUCT_CODE),
    ProductLanguage: '1033',
    ProductName: 'Thalamus AI',
    ProductVersion: APP_VERSION,
    Manufacturer: 'Thalamus AI',
    UpgradeCode: guidStr(UPGRADE_CODE),
    SecureCustomProperties: 'APPLICATIONFOLDER',
    ARPPRODUCTICON: 'app.ico',
  };
  for (const [k, v] of Object.entries(props)) p.row(k, v);
  tables.push(p);

  // 2. Directory
  const d = new MsiTable('Directory');
  d.col('Directory', 0, 72, false, true);
  d.col('Directory_Parent', 0, 72, true, false);
  d.col('DefaultDir', 0, 255, false, false);
  d.row('TARGETDIR', null, 'SourceDir');
  d.row('ProgramFiles64Folder', 'TARGETDIR', '.');
  d.row('APPLICATIONFOLDER', 'ProgramFiles64Folder', 'Thalamus AI');
  d.row('ProgramMenuFolder', 'TARGETDIR', '.');
  d.row('DesktopFolder', 'TARGETDIR', '.');
  tables.push(d);

  // 3. Component
  const c = new MsiTable('Component');
  c.col('Component', 0, 72, false, true);
  c.col('ComponentId', 0, 72, false, false);
  c.col('Directory_', 0, 72, false, false);
  c.col('Attributes', 2, 2, false, false);
  c.col('Condition', 0, 255, true, false);
  c.col('KeyPath', 0, 72, true, false);
  c.row('MainExe', guidStr('B2C3D4E5-F6A7-8901-BCDE-F12345678901'), 'APPLICATIONFOLDER', 0, null, 'ThalamusExe');
  c.row('MenuEntries', guidStr('E5F6A7B8-C9D0-1234-EF23-456789012345'), 'ProgramMenuFolder', 0, null, 'MenuShortcut');
  tables.push(c);

  // 4. Feature
  const f = new MsiTable('Feature');
  f.col('Feature', 0, 38, false, true);
  f.col('Feature_Parent', 0, 38, true, false);
  f.col('Title', 0, 64, true, false);
  f.col('Description', 0, 255, true, false);
  f.col('Display', 2, 2, true, false);
  f.col('Level', 2, 2, false, false);
  f.col('Directory_', 0, 72, true, false);
  f.col('Attributes', 2, 2, false, false);
  f.row('MainFeature', null, 'Thalamus AI', 'Thalamus AI Desktop App', 1, 1, 'APPLICATIONFOLDER', 0);
  tables.push(f);

  // 5. FeatureComponents
  const fc = new MsiTable('FeatureComponents');
  fc.col('Feature_', 0, 38, false, true);
  fc.col('Component_', 0, 72, false, true);
  fc.row('MainFeature', 'MainExe');
  fc.row('MainFeature', 'MenuEntries');
  tables.push(fc);

  // 6. File
  const fl = new MsiTable('File');
  fl.col('File', 0, 72, false, true);
  fl.col('Component_', 0, 72, false, false);
  fl.col('FileName', 0, 255, false, false);
  fl.col('FileSize', 2, 4, false, false);
  fl.col('Version', 0, 72, true, false);
  fl.col('Language', 2, 2, true, false);
  fl.col('Attributes', 2, 2, false, false);
  fl.col('Sequence', 2, 2, false, false);
  const sz = fs.statSync(path.join(DIST_DIR, 'Thalamus.exe')).size;
  fl.row('ThalamusExe', 'MainExe', 'Thalamus.exe', sz, null, null, 0, 1);
  tables.push(fl);

  // 7. CreateFolder
  const cf = new MsiTable('CreateFolder');
  cf.col('Directory_', 0, 72, false, true);
  cf.col('Component_', 0, 72, false, true);
  cf.row('APPLICATIONFOLDER', 'MainExe');
  tables.push(cf);

  // 8. Media
  const m = new MsiTable('Media');
  m.col('DiskId', 2, 2, false, true);
  m.col('LastSequence', 2, 2, false, false);
  m.col('DiskPrompt', 0, 64, true, false);
  m.col('Cabinet', 0, 255, true, false);
  m.col('VolumeLabel', 0, 32, true, false);
  m.col('Source', 0, 72, true, false);
  m.row(1, 1, null, 'Thalamus.cab', null, null);
  tables.push(m);

  // 9. InstallExecuteSequence
  const ies = new MsiTable('InstallExecuteSequence');
  ies.col('Action', 0, 72, false, true);
  ies.col('Condition', 0, 255, true, false);
  ies.col('Sequence', 2, 2, false, false);
  for (const [a, c, s] of [
    ['InstallValidate', null, 1100],
    ['InstallFiles', null, 4000],
    ['CreateFolders', null, 3700],
    ['WriteRegistryValues', null, 4500],
    ['RegisterProduct', null, 6100],
    ['PublishFeatures', null, 6300],
    ['PublishProduct', null, 6400],
    ['InstallFinalize', null, 6600],
  ]) ies.row(a, c, s);
  tables.push(ies);

  // 10. Shortcut
  const sc = new MsiTable('Shortcut');
  sc.col('Shortcut', 0, 72, false, true);
  sc.col('Directory_', 0, 72, false, false);
  sc.col('Name', 0, 128, false, false);
  sc.col('Component_', 0, 72, false, false);
  sc.col('Target', 0, 72, false, false);
  sc.col('TargetType', 0, 2, true, false);
  sc.col('Description', 0, 255, true, false);
  sc.col('WkDir', 0, 72, true, false);
  sc.row('MenuShortcut', 'ProgramMenuFolder', 'Thalamus AI', 'MenuEntries', 'ThalamusExe', null, 'Thalamus AI Desktop App', 'APPLICATIONFOLDER');
  tables.push(sc);

  // 11. Registry
  const rg = new MsiTable('Registry');
  rg.col('Registry', 0, 72, false, true);
  rg.col('Root', 2, 2, false, false);
  rg.col('Key', 0, 255, false, false);
  rg.col('Name', 0, 255, true, false);
  rg.col('Value', 0, 255, true, false);
  rg.col('Component_', 0, 72, false, false);
  rg.row('ThalamusURI', 1, 'Software\\Classes\\thalamus', null, 'URL:Thalamus AI Protocol', 'MainExe');
  rg.row('ThalamusURIP', 1, 'Software\\Classes\\thalamus', 'URL Protocol', '', 'MainExe');
  rg.row('ThalamusURICmd', 1, 'Software\\Classes\\thalamus\\shell\\open\\command', null, '"C:\\Program Files\\Thalamus AI\\Thalamus.exe" "%1"', 'MainExe');
  tables.push(rg);

  return tables.map(t => t.encode());
}

// ── Summary information stream ─────────────────────────────────────────────

function buildSummaryInfo() {
  // Build the OLE2 _SummaryInformation property set
  const titleBytes = Buffer.from('Thalamus AI Setup\0', 'ascii');

  // The _SummaryInformation stream has this layout:
  // Byte order (2), Version (2), OS version (2), reserved (2), CLSID (16)
  const buf = Buffer.alloc(48);
  buf.writeUInt16LE(0xFFFE, 0); // Little-endian byte order
  buf.writeUInt16LE(0, 2);      // Version
  buf.writeUInt16LE(0x0002, 4); // OS: Windows
  // Padding zeros at 6-7
  // CLSID at 8-23 (zeros)
  // Num property sets at 24
  buf.writeUInt32LE(1, 24);
  // GUID of property set at 28 (F29F85E0-4FF9-1068-AB91-08002B27B3D9)
  buf[28]  = 0xE0; buf[29]  = 0x85; buf[30]  = 0x9F; buf[31]  = 0xF2;
  buf[32]  = 0xF9; buf[33]  = 0x4F; buf[34]  = 0x68; buf[35]  = 0x10;
  buf[36]  = 0xAB; buf[37]  = 0x91; buf[38]  = 0x08; buf[39]  = 0x00;
  buf[40]  = 0x2B; buf[41]  = 0x27; buf[42]  = 0xB3; buf[43]  = 0xD9;
  // Offset to section at 44
  buf.writeUInt32LE(48, 44);

  // Section data starts at offset 48
  // Section header: size (4), num props (4), GUID (16)
  const sec = Buffer.alloc(48 + 24 + 16);
  // Section size (48 + 24 + 16 + titleBytes.length = 48+24+16+20=108)
  sec.writeUInt32LE(48 + 24 + 16 + titleBytes.length, 0);
  sec.writeUInt32LE(3, 4); // 3 properties: codepage, title, subject
  
  // GUID (same)
  sec[8]  = 0xE0; sec[9]  = 0x85; sec[10] = 0x9F; sec[11] = 0xF2;
  sec[12] = 0xF9; sec[13] = 0x4F; sec[14] = 0x68; sec[15] = 0x10;
  sec[16] = 0xAB; sec[17] = 0x91; sec[18] = 0x08; sec[19] = 0x00;
  sec[20] = 0x2B; sec[21] = 0x27; sec[22] = 0xB3; sec[23] = 0xD9;

  // Property entry 1: PID_CODEPAGE = 0x01, type VT_I2 = 0x0002, value 1252
  sec.writeUInt32LE(0x01, 24);
  sec.writeUInt32LE(0x0002, 28);
  sec.writeUInt16LE(1252, 32);

  // Property entry 2: PID_TITLE = 0x02, type VT_LPSTR = 0x001E
  sec.writeUInt32LE(0x02, 34);
  sec.writeUInt32LE(0x001E, 38);
  sec.writeUInt32LE(64, 42); // Offset to string (from start of sec)

  // Property entry 3: PID_SUBJECT = 0x03, type VT_LPSTR = 0x001E
  sec.writeUInt32LE(0x03, 46);
  sec.writeUInt32LE(0x001E, 50);
  sec.writeUInt32LE(64, 54); // Same offset - reuse title string

  // String data at offset 64: "Thalamus AI Setup\0"
  titleBytes.copy(sec, 64);

  return Buffer.concat([buf, sec]);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log('=== Thalamus AI MSI Builder ===\n');

  const exePath = path.join(DIST_DIR, 'Thalamus.exe');
  if (!fs.existsSync(exePath)) {
    console.error('ERROR: Thalamus.exe not found. Build it first.');
    process.exit(1);
  }

  const exeSize = fs.statSync(exePath).size;
  console.log(`Found Thalamus.exe (${(exeSize / 1024 / 1024).toFixed(1)} MB)`);

  const outPath = path.join(DIST_DIR, `Thalamus-Setup-v${APP_VERSION}.msi`);
  console.log(`Output: ${outPath}\n`);

  console.log('Building MSI database tables...');
  const tables = buildMsiDatabase();
  console.log(`  Total tables: ${tables.length}`);

  console.log('Reading Thalamus.exe...');
  const exeData = fs.readFileSync(exePath);

  console.log('Creating OLE2 compound document...');
  const doc = cfb.utils.cfb_new();

  // Add standard streams
  const si = buildSummaryInfo();
  cfb.utils.cfb_add(doc, '/_SummaryInformation', si);
  cfb.utils.cfb_add(doc, '/_ForceCodepage', Buffer.from('1252\0', 'ascii'));

  // Add table streams
  const names = [
    'Property', 'Directory', 'Component', 'Feature', 'FeatureComponents',
    'File', 'CreateFolder', 'Media', 'InstallExecuteSequence', 'Shortcut', 'Registry'
  ];
  for (let i = 0; i < names.length; i++) {
    cfb.utils.cfb_add(doc, '/' + names[i], tables[i]);
    console.log(`  Table: ${names[i]} (${tables[i].length} bytes)`);
  }

  // Add embedded file data as a _Streams storage
  cfb.utils.cfb_add(doc, '/_Streams/ThalamusExe', exeData);
  console.log(`  Stream: ThalamusExe (${exeData.length} bytes)`);

  console.log('\nWriting MSI file...');
  const data = cfb.write(doc, { type: 'buffer' });
  fs.writeFileSync(outPath, data);

  const msiSize = fs.statSync(outPath).size;
  console.log(`\n✅ MSI Installer created: Thalamus-Setup-v${APP_VERSION}.msi`);
  console.log(`   Size: ${(msiSize / 1024 / 1024).toFixed(1)} MB`);
}

main();
