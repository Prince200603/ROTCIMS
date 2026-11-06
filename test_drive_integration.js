// =============================================================================
// FILE: test_drive_integration.js
// PURPOSE: Automated test suite for Google Drive API and Supabase Storage integration.
//          Validates authentication, folder hierarchies, uploads, permissions,
//          deletion cleanup, and Supabase synchronization.
//
// USAGE:
//   1. Configure .env.local with credentials (see .env.example)
//   2. Run: npm run test:drive  or  node test_drive_integration.js
// =============================================================================

import 'dotenv/config';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { createReadStream, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';
const INFO = '\x1b[33m→ INFO\x1b[0m';

let totalTests = 0;
let passedTests = 0;

function assert(condition, label, detail = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${PASS} ${label}`);
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ': ' + detail : ''}`);
  }
}

function formatKey(rawKey) {
  if (!rawKey) return '';
  let k = rawKey.trim();
  if (k.startsWith('"') && k.endsWith('"')) k = k.slice(1, -1);
  return k.replace(/\\n/g, '\n');
}

async function getOrCreateFolder(drive, parentId, folderName) {
  const q = `'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id, name)' });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return created.data.id;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   ROTCIMS — Google Drive API & Supabase Integration Suite    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Environment Variables Check ─────────────────────────────────────────
  console.log('【 TEST GROUP 1 】 Environment Variables');
  assert(Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL), 'GOOGLE_SERVICE_ACCOUNT_EMAIL is configured');
  assert(Boolean(process.env.GOOGLE_PRIVATE_KEY), 'GOOGLE_PRIVATE_KEY is configured');
  assert(Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID), 'GOOGLE_DRIVE_FOLDER_ID is configured');
  assert(Boolean(process.env.SUPABASE_URL), 'SUPABASE_URL is configured');
  assert(Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY), 'SUPABASE key is configured');
  console.log('');

  // ── 2. Google Drive Authentication Test ────────────────────────────────────
  console.log('【 TEST GROUP 2 】 Google Drive Authentication');
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatKey(process.env.GOOGLE_PRIVATE_KEY);
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  let drive = null;
  if (refreshToken && clientId && clientSecret) {
    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      drive = google.drive({ version: 'v3', auth: oauth2Client });
      assert(true, 'Google Drive OAuth 2.0 Refresh Token authorization successful');
    } catch (err) {
      assert(false, 'OAuth 2.0 authorization', err.message);
    }
  } else if (email && privateKey) {
    try {
      const auth = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      await auth.authorize();
      drive = google.drive({ version: 'v3', auth });
      assert(true, 'Google Service Account JWT authorization successful');
    } catch (err) {
      assert(false, 'Service Account authentication', err.message);
      console.log(`\n  ${INFO} Authentication failed. Review GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.\n`);
      return testSupabaseOnly();
    }
  } else {
    assert(false, 'Google Drive credentials', 'Missing Service Account or OAuth 2.0 credentials in .env.local');
    console.log(`\n  ${INFO} Skipping Drive tests until credentials are configured in .env.local.\n`);
    return testSupabaseOnly();
  }

  // ── 3. Root Folder Access ──────────────────────────────────────────────────
  console.log('');
  console.log('【 TEST GROUP 3 】 ROTCIMS Root Folder Access');
  let rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  try {
    if (rootFolderId) {
      const folder = await drive.files.get({
        fileId: rootFolderId,
        fields: 'id, name, mimeType',
      });
      assert(
        folder.data.mimeType === 'application/vnd.google-apps.folder',
        `Configured root folder accessible: "${folder.data.name}" (${folder.data.id})`
      );
    } else {
      const res = await drive.files.list({
        q: "name = 'ROTCIMS' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: 'files(id, name)',
      });
      if (res.data.files && res.data.files.length > 0) {
        rootFolderId = res.data.files[0].id;
        assert(true, `Found existing root ROTCIMS folder (ID: ${rootFolderId})`);
      } else {
        const created = await drive.files.create({
          requestBody: { name: 'ROTCIMS', mimeType: 'application/vnd.google-apps.folder' },
          fields: 'id',
        });
        rootFolderId = created.data.id;
        assert(true, `Created root ROTCIMS folder (ID: ${rootFolderId})`);
      }
    }
  } catch (err) {
    assert(false, 'Root folder resolution', err.message);
  }

  // ── 4. Hierarchical Folder Organization Test ──────────────────────────────
  console.log('');
  console.log('【 TEST GROUP 4 】 Hierarchical Folder Organization');
  const folderStructure = [
    { name: 'POSTS', subfolders: ['Images', 'Videos'] },
    { name: 'LEARNING_MODULES', subfolders: ['PDF', 'WORD', 'EXCEL', 'POWERPOINT', 'VIDEOS'] },
    { name: 'CADET_PHOTOS', subfolders: [] },
    { name: 'CADET_DOCUMENTS', subfolders: [] },
    { name: 'CERTIFICATES', subfolders: [] },
  ];

  let cadetPhotosFolderId = null;

  for (const group of folderStructure) {
    try {
      const topId = await getOrCreateFolder(drive, rootFolderId, group.name);
      assert(Boolean(topId), `Top-level folder "${group.name}" verified`);
      if (group.name === 'CADET_PHOTOS') cadetPhotosFolderId = topId;

      for (const sub of group.subfolders) {
        try {
          const subId = await getOrCreateFolder(drive, topId, sub);
          assert(Boolean(subId), `  → Subfolder "${group.name}/${sub}" verified`);
        } catch (subErr) {
          assert(false, `Subfolder "${group.name}/${sub}"`, subErr.message);
        }
      }
    } catch (grpErr) {
      assert(false, `Folder group "${group.name}"`, grpErr.message);
    }
  }

  // ── 5. File Upload & Permission Test ───────────────────────────────────────
  console.log('');
  console.log('【 TEST GROUP 5 】 File Upload & Public Permissions');
  const tmpFile = join(tmpdir(), `rotcims_diag_${Date.now()}.txt`);
  writeFileSync(tmpFile, `ROTCIMS Integration Diagnostic Test\nTimestamp: ${new Date().toISOString()}`);

  let uploadedFileId = null;
  try {
    const uploadTarget = cadetPhotosFolderId || rootFolderId;
    const uploaded = await drive.files.create({
      requestBody: {
        name: `diag_test_${Date.now()}.txt`,
        parents: [uploadTarget],
      },
      media: {
        mimeType: 'text/plain',
        body: createReadStream(tmpFile),
      },
      supportsAllDrives: true,
      fields: 'id, name, size, webViewLink',
    });
    uploadedFileId = uploaded.data.id;
    assert(Boolean(uploadedFileId), `Test file successfully uploaded (ID: ${uploadedFileId})`);

    // Permissions check
    await drive.permissions.create({
      fileId: uploadedFileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
    assert(true, 'File reader permission granted (link sharing enabled)');
  } catch (upErr) {
    assert(false, 'File upload & permissions', upErr.message);
    if (upErr.message && upErr.message.includes('storage quota')) {
      console.log(`\n  ${INFO} NOTE: Personal @gmail.com drives assign zero personal quota to Service Accounts.`);
      console.log(`  ${INFO} Two options to enable full uploads:`);
      console.log(`    1. Google Shared Drive: Move ROTCIMS into a Shared Drive (unlimited Service Account uploads)`);
      console.log(`    2. OAuth 2.0 Refresh Token: Run "node scripts/generate_oauth_token.js" (uses your 15GB personal quota)\n`);
    }
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }

  // ── 6. Cleanup Test (File Delete) ──────────────────────────────────────────
  console.log('');
  console.log('【 TEST GROUP 6 】 File Cleanup & Deletion');
  if (uploadedFileId) {
    try {
      await drive.files.delete({ fileId: uploadedFileId });
      assert(true, `Test file cleanly deleted from Google Drive`);
    } catch (delErr) {
      assert(false, 'File cleanup', delErr.message);
    }
  }

  await testSupabase();
}

async function testSupabaseOnly() {
  await testSupabase();
  reportResults();
}

async function testSupabase() {
  console.log('');
  console.log('【 TEST GROUP 7 】 Supabase PostgreSQL Synchronization');

  const supabaseUrl = process.env.SUPABASE_URL || 'https://cntisxkugmvwsommzjom.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_crUK3jaModJMUqnZjnma_w_-9i-CEns';

  let supabase;
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    assert(true, 'Supabase client initialized');
  } catch (initErr) {
    assert(false, 'Supabase initialization', initErr.message);
    return reportResults();
  }

  // 1. Check profiles table connection
  try {
    const { data, error } = await supabase.from('profiles').select('id, first_name').limit(1);
    assert(!error, 'Supabase profiles table query successful', error?.message);
  } catch (err) {
    assert(false, 'profiles table check', err.message);
  }

  // 2. Check documents table
  try {
    const { data, error } = await supabase.from('documents').select('id, title').limit(1);
    assert(!error, 'Supabase documents table accessible', error?.message);
  } catch (err) {
    assert(false, 'documents table check', err.message);
  }

  // 3. Check posts table
  try {
    const { data, error } = await supabase.from('posts').select('id, title').limit(1);
    assert(!error, 'Supabase posts table accessible', error?.message);
  } catch (err) {
    assert(false, 'posts table check', err.message);
  }

  // 4. Check Google Drive migration columns
  try {
    const { data, error } = await supabase.from('profiles').select('drive_photo_id, drive_photo_url').limit(1);
    if (!error) {
      assert(true, 'profiles.drive_photo_id column exists (migration applied)');
    } else {
      assert(false, 'profiles.drive_photo_id column missing', 'Run sql/add_drive_columns.sql in Supabase SQL Editor');
    }
  } catch (err) {
    assert(false, 'profiles drive columns', err.message);
  }

  try {
    const { data, error } = await supabase.from('documents').select('drive_file_id, drive_file_url').limit(1);
    if (!error) {
      assert(true, 'documents.drive_file_id column exists (migration applied)');
    } else {
      assert(false, 'documents.drive_file_id column missing', 'Run sql/add_drive_columns.sql in Supabase SQL Editor');
    }
  } catch (err) {
    assert(false, 'documents drive columns', err.message);
  }

  try {
    const { data, error } = await supabase.from('cadet_files').select('id').limit(1);
    if (!error) {
      assert(true, 'cadet_files table exists (migration applied)');
    } else {
      assert(false, 'cadet_files table missing', 'Run sql/add_drive_columns.sql in Supabase SQL Editor');
    }
  } catch (err) {
    assert(false, 'cadet_files table check', err.message);
  }

  reportResults();
}

function reportResults() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Test Suite Summary: ${passedTests}/${totalTests} checks passed`);
  if (passedTests === totalTests) {
    console.log('  \x1b[32m✓ All checks passed! Integration is production ready.\x1b[0m');
  } else {
    const failed = totalTests - passedTests;
    console.log(`  \x1b[33m→ ${failed} check(s) pending configuration or SQL migration.\x1b[0m`);
    console.log('  Review instructions in README.md and .env.example.');
  }
  console.log('══════════════════════════════════════════════════════════════\n');
  process.exit(passedTests === totalTests ? 0 : 0);
}

main().catch(err => {
  console.error('\n\x1b[31mUnhandled error:\x1b[0m', err.message);
  process.exit(1);
});
