// =============================================================================
// FILE: api/drive/status.js
// PURPOSE: Vercel Serverless Function — returns diagnostic health and
//          connectivity status of the Google Drive integration, verifying
//          root folder and required subfolder structures.
//
// METHOD: GET, OPTIONS
// =============================================================================

import { google } from 'googleapis';

function formatPrivateKey(rawKey) {
  if (!rawKey) return '';
  let key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const supabaseUrl = process.env.SUPABASE_URL;

  const hasOAuth2 = Boolean(refreshToken && clientId && clientSecret);
  const hasServiceAccount = Boolean(email && privateKey);

  const configCheck = {
    authMode: hasOAuth2 ? 'oauth2' : (hasServiceAccount ? 'service_account' : 'none'),
    oauth2Configured: hasOAuth2,
    serviceAccountEmailSet: Boolean(email),
    privateKeySet: Boolean(privateKey),
    rootFolderIdSet: Boolean(rootFolderId),
    supabaseUrlSet: Boolean(supabaseUrl),
  };

  if (!hasOAuth2 && !hasServiceAccount) {
    return res.status(200).json({
      ok: false,
      connected: false,
      message: 'Google Drive credentials are not configured. Provide OAuth2 Refresh Token (GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) or Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY).',
      checks: configCheck,
    });
  }

  try {
    let auth;
    if (hasOAuth2) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      auth = oauth2Client;
    } else {
      const jwtAuth = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      await jwtAuth.authorize();
      auth = jwtAuth;
    }

    const drive = google.drive({ version: 'v3', auth });

    // Verify root folder or list folders
    let resolvedRootId = rootFolderId;
    if (!resolvedRootId) {
      const searchRes = await drive.files.list({
        q: "name = 'ROTCIMS' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: 'files(id, name)',
        spaces: 'drive',
      });
      if (searchRes.data.files && searchRes.data.files.length > 0) {
        resolvedRootId = searchRes.data.files[0].id;
      }
    }

    // List top-level folders inside root if resolved
    const topFolders = {};
    if (resolvedRootId) {
      const subRes = await drive.files.list({
        q: `'${resolvedRootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      });
      (subRes.data.files || []).forEach(f => {
        topFolders[f.name] = f.id;
      });
    }

    return res.status(200).json({
      ok: true,
      connected: true,
      message: 'Google Drive API successfully connected.',
      serviceAccount: hasOAuth2 ? 'OAuth 2.0 User Account' : (email ? email.replace(/@.+$/, '@...') : 'None'),
      authMode: hasOAuth2 ? 'oauth2' : 'service_account',
      rootFolderId: resolvedRootId || null,
      topFolders,
      requiredHierarchy: {
        'POSTS': ['Images', 'Videos'],
        'LEARNING_MODULES': ['PDF', 'WORD', 'EXCEL', 'POWERPOINT', 'VIDEOS'],
        'CADET_PHOTOS': [],
        'CADET_DOCUMENTS': [],
        'CERTIFICATES': [],
      },
      checks: configCheck,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      connected: false,
      message: `Google Drive connection error: ${err.message}`,
      checks: configCheck,
    });
  }
}
