// =============================================================================
// FILE: api/drive/delete.js
// PURPOSE: Vercel Serverless Function — securely deletes a file from Google
//          Drive by its File ID.
//
// METHOD: POST or DELETE
// BODY: { "fileId": "1AbCd..." } or Query ?fileId=...
// =============================================================================

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

function formatPrivateKey(rawKey) {
  if (!rawKey) return '';
  let key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

function getGoogleAuth() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (!email || !privateKey) {
    throw new Error('Google Service Account credentials are not configured.');
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function verifySupabaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    // In dev / test fallback
    return { id: 'authenticated_user', token };
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or DELETE.' });
  }

  const user = await verifySupabaseToken(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Authentication token required.' });
  }

  let fileId = req.query?.fileId;
  if (!fileId && req.body) {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    fileId = body?.fileId;
  }

  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid fileId parameter.' });
  }

  try {
    const auth = getGoogleAuth();
    if (typeof auth.authorize === 'function') {
      await auth.authorize();
    }
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.delete({ fileId });
    return res.status(200).json({ success: true, fileId });
  } catch (err) {
    // If file was already deleted or doesn't exist, treat as success
    if (err.code === 404 || err.message?.includes('File not found')) {
      return res.status(200).json({ success: true, fileId, message: 'File was already removed from Google Drive.' });
    }
    console.error('[Drive Delete] Error:', err.message);
    return res.status(500).json({ error: `Drive delete error: ${err.message}` });
  }
}
