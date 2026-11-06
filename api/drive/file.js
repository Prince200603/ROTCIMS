// =============================================================================
// FILE: api/drive/file.js
// PURPOSE: Vercel Serverless Function — provides secure server-side file retrieval,
//          previews, authenticated downloads, and byte-range video streaming
//          directly from Google Drive without exposing private credentials.
//
// USAGE:
//   GET /api/drive/file?fileId=<ID>&action=stream|download|preview|info
//
// SUPPORTS:
//   - HTTP 206 Partial Content (Range requests) for video playback seeking
//   - Content-Disposition attachment for downloads
//   - Content-Disposition inline for browser previews
//   - JSON file metadata endpoint (action=info)
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
    throw new Error('Google Drive credentials are not configured.');
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or HEAD.' });
  }

  const { fileId, action = 'preview' } = req.query;

  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid fileId parameter.' });
  }

  let drive;
  try {
    const auth = getGoogleAuth();
    if (typeof auth.authorize === 'function') {
      await auth.authorize();
    }
    drive = google.drive({ version: 'v3', auth });
  } catch (authErr) {
    return res.status(500).json({ error: `Google Drive connection error: ${authErr.message}` });
  }

  let fileMeta;
  try {
    const metaRes = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, webViewLink',
    });
    fileMeta = metaRes.data;
  } catch (metaErr) {
    if (metaErr.code === 404) {
      return res.status(404).json({ error: 'File not found in Google Drive.' });
    }
    return res.status(500).json({ error: `Error fetching file metadata: ${metaErr.message}` });
  }

  // Action: info
  if (action === 'info') {
    return res.status(200).json({
      success: true,
      file: {
        id: fileMeta.id,
        name: fileMeta.name,
        mimeType: fileMeta.mimeType,
        size: fileMeta.size ? parseInt(fileMeta.size, 10) : 0,
        webViewLink: fileMeta.webViewLink,
      },
    });
  }

  const mimeType = fileMeta.mimeType || 'application/octet-stream';
  const fileName = fileMeta.name || `file_${fileId}`;
  const fileSize = fileMeta.size ? parseInt(fileMeta.size, 10) : 0;

  // HEAD request returns headers only
  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', mimeType);
    if (fileSize) res.setHeader('Content-Length', fileSize);
    res.setHeader('Accept-Ranges', 'bytes');
    return res.status(200).end();
  }

  // Action: download
  if (action === 'download') {
    try {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      if (fileSize) res.setHeader('Content-Length', fileSize);

      const mediaStream = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      mediaStream.data.pipe(res);
      return;
    } catch (streamErr) {
      return res.status(500).json({ error: `Download streaming failed: ${streamErr.message}` });
    }
  }

  // Action: stream (video / audio byte-range requests)
  if (action === 'stream' && fileSize > 0) {
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=86400',
      });

      try {
        const partialStream = await drive.files.get(
          { fileId, alt: 'media' },
          {
            responseType: 'stream',
            headers: { Range: `bytes=${start}-${end}` },
          }
        );
        partialStream.data.pipe(res);
        return;
      } catch (err) {
        return res.status(500).end();
      }
    }
  }

  // Action: preview or standard stream (default)
  try {
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (fileSize) res.setHeader('Content-Length', fileSize);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

    const stream = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    stream.data.pipe(res);
  } catch (err) {
    return res.status(500).json({ error: `Streaming file failed: ${err.message}` });
  }
}
