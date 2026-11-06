// =============================================================================
// FILE: api/drive/upload.js
// PURPOSE: Vercel Serverless Function — receives files via multipart form,
//          authenticates to Google Drive via Service Account, routes files
//          to the correct Google Drive folder hierarchy:
//            - POSTS/Videos
//            - POSTS/Images
//            - LEARNING_MODULES/PDF
//            - LEARNING_MODULES/WORD
//            - LEARNING_MODULES/EXCEL
//            - LEARNING_MODULES/POWERPOINT
//            - LEARNING_MODULES/VIDEOS
//            - CADET_PHOTOS
//            - CADET_DOCUMENTS
//            - CERTIFICATES
//          applies view permissions, and returns file IDs and direct URLs.
//
// ENVIRONMENT VARIABLES REQUIRED:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  — Google Cloud Service Account email
//   GOOGLE_PRIVATE_KEY            — RSA private key (with \n newlines)
//   GOOGLE_DRIVE_FOLDER_ID        — Root ROTCIMS folder ID in Google Drive
//   SUPABASE_URL                  — Supabase project URL (for token verification)
//   SUPABASE_SERVICE_ROLE_KEY     — Supabase service role key (optional in dev)
// =============================================================================

import { google } from 'googleapis';
import formidable from 'formidable';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Disable Vercel's default body parser so formidable can process the multipart stream
export const config = {
  api: {
    bodyParser: false,
  },
};

// Map of predefined folder keys to directory path segments inside root ROTCIMS folder
const FOLDER_PATH_MAPPINGS = {
  // Posts
  'posts/videos':               ['POSTS', 'Videos'],
  'posts_videos':               ['POSTS', 'Videos'],
  'posts/images':               ['POSTS', 'Images'],
  'posts_images':               ['POSTS', 'Images'],

  // Learning Modules
  'learning_modules/pdf':        ['LEARNING_MODULES', 'PDF'],
  'learning_modules_pdf':        ['LEARNING_MODULES', 'PDF'],
  'learning_modules/word':       ['LEARNING_MODULES', 'WORD'],
  'learning_modules_word':       ['LEARNING_MODULES', 'WORD'],
  'learning_modules/excel':      ['LEARNING_MODULES', 'EXCEL'],
  'learning_modules_excel':      ['LEARNING_MODULES', 'EXCEL'],
  'learning_modules/powerpoint': ['LEARNING_MODULES', 'POWERPOINT'],
  'learning_modules_powerpoint': ['LEARNING_MODULES', 'POWERPOINT'],
  'learning_modules/videos':     ['LEARNING_MODULES', 'VIDEOS'],
  'learning_modules_videos':     ['LEARNING_MODULES', 'VIDEOS'],

  // Cadet Records & Certificates
  'cadet_photos':               ['CADET_PHOTOS'],
  'cadet_photos/photos':        ['CADET_PHOTOS'],
  'cadet_documents':            ['CADET_DOCUMENTS'],
  'certificates':               ['CERTIFICATES'],

  // Legacy mappings for backward compatibility
  'photos':                     ['CADET_PHOTOS'],
  'documents':                  ['LEARNING_MODULES', 'PDF'],
  'attachments':                ['CADET_DOCUMENTS'],
};

// Extension to MIME type mapping for fallback when browsers report generic octet-stream
const EXTENSION_MIME_MAP = {
  // Documents
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv:  'text/csv',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:  'text/plain',

  // Images
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  gif:  'image/gif',
  svg:  'image/svg+xml',

  // Videos
  mp4:  'video/mp4',
  mov:  'video/quicktime',
  webm: 'video/webm',
  avi:  'video/x-msvideo',
  mkv:  'video/x-matroska',
};

// Permitted MIME types whitelist
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
  // Videos
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/mpeg',
  // PDF
  'application/pdf',
  // Microsoft Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Microsoft Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  // Microsoft PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Plain text
  'text/plain',
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB max limit

// In-memory folder resolution cache to avoid excessive Drive API lookups
const folderCache = new Map();

// Normalize and format Google Service Account private key
function formatPrivateKey(rawKey) {
  if (!rawKey) return '';
  let key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

// Build Google Drive Auth Client (supports OAuth2 Refresh Token or Service Account JWT)
function getGoogleAuth() {
  // Option A: OAuth 2.0 with Refresh Token (recommended for personal @gmail.com accounts — uses user's 15GB quota)
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  // Option B: Google Cloud Service Account JWT (recommended for Google Shared Drives / Workspace)
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (!email || !privateKey) {
    throw new Error('Google Drive credentials are not configured. Provide OAuth2 Refresh Token (GOOGLE_REFRESH_TOKEN) or Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY).');
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

// Verify incoming Supabase JWT Token
async function verifySupabaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    // In local dev or when service role key isn't set, allow token presence
    return { id: 'authenticated_user', token };
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.warn('[Drive Upload] Supabase getUser note:', error?.message);
      return null;
    }
    return user;
  } catch (err) {
    console.warn('[Drive Upload] Token verify note:', err.message);
    return null;
  }
}

// Resolve or create root ROTCIMS folder in Google Drive
async function getOrCreateRootFolder(drive) {
  if (process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_DRIVE_FOLDER_ID.trim()) {
    return process.env.GOOGLE_DRIVE_FOLDER_ID.trim();
  }

  const cached = folderCache.get('__ROOT__');
  if (cached) return cached;

  const res = await drive.files.list({
    q: "name = 'ROTCIMS' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (res.data.files && res.data.files.length > 0) {
    const rootId = res.data.files[0].id;
    folderCache.set('__ROOT__', rootId);
    return rootId;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: 'ROTCIMS',
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  folderCache.set('__ROOT__', folder.data.id);
  return folder.data.id;
}

// Resolve or create designated subfolder inside a given parent folder
async function getOrCreateSubfolder(drive, parentFolderId, folderName) {
  const cacheKey = `${parentFolderId}/${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  const res = await drive.files.list({
    q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (res.data.files && res.data.files.length > 0) {
    const folderId = res.data.files[0].id;
    folderCache.set(cacheKey, folderId);
    return folderId;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  folderCache.set(cacheKey, folder.data.id);
  return folder.data.id;
}

// Recursively resolve or create folder hierarchy segments (e.g. ['POSTS', 'Images'])
async function resolveFolderHierarchy(drive, rootFolderId, pathSegments) {
  let currentFolderId = rootFolderId;
  for (const segment of pathSegments) {
    currentFolderId = await getOrCreateSubfolder(drive, currentFolderId, segment);
  }
  return currentFolderId;
}

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Parse multipart form data
  let fields, files;
  try {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE_BYTES,
      keepExtensions: true,
      multiples: false,
    });

    const parsed = form.parse(req);
    if (parsed && typeof parsed.then === 'function') {
      [fields, files] = await parsed;
    } else {
      [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, f, fi) => (err ? reject(err) : resolve([f, fi])));
      });
    }
  } catch (parseErr) {
    return res.status(400).json({ error: `File parse failed: ${parseErr.message}` });
  }

  const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'No file received in request (form field "file").' });
  }

  const tempFilePath = uploadedFile.filepath || uploadedFile.path;

  // Determine target folder segments
  const rawFolder = Array.isArray(fields.folder) ? fields.folder[0] : (fields.folder || 'cadet_documents');
  const normalizedFolderKey = (rawFolder || '').toLowerCase().trim();

  let pathSegments = FOLDER_PATH_MAPPINGS[normalizedFolderKey];
  if (!pathSegments) {
    // If not in predefined mapping, treat as custom slash-delimited path (e.g. "POSTS/Images")
    pathSegments = rawFolder.split('/').map(s => s.trim()).filter(Boolean);
    if (pathSegments.length === 0) pathSegments = ['CADET_DOCUMENTS'];
  }

  // Determine file MIME type and extension
  const rawFilename = Array.isArray(fields.fileName) ? fields.fileName[0] : (fields.fileName || uploadedFile.originalFilename || 'unnamed_file');
  const fileExt = (rawFilename.split('.').pop() || '').toLowerCase();
  let mimeType = uploadedFile.mimetype || 'application/octet-stream';

  if (mimeType === 'application/octet-stream' && EXTENSION_MIME_MAP[fileExt]) {
    mimeType = EXTENSION_MIME_MAP[fileExt];
  }

  // Authentication check
  // Allow photo uploads during cadet registration without pre-existing session if it's an image
  const authHeader = req.headers.authorization;
  const user = await verifySupabaseToken(authHeader);
  const isImageFile = mimeType.startsWith('image/');
  const isPhotoFolder = pathSegments.includes('CADET_PHOTOS');

  if (!user && !(isPhotoFolder && isImageFile)) {
    try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
    return res.status(401).json({ error: 'Authentication required. Please log in to upload files.' });
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
    return res.status(400).json({
      error: `File type "${mimeType}" is not permitted. Permitted formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, PNG, WEBP, MP4, MOV, WEBM.`,
    });
  }

  // Validate size for photos specifically (15MB max)
  if (isPhotoFolder && uploadedFile.size > 15 * 1024 * 1024) {
    try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
    return res.status(400).json({ error: 'Profile photo exceeds 15 MB limit.' });
  }

  // Initialize Google Drive Client
  let drive;
  try {
    const auth = getGoogleAuth();
    await auth.authorize();
    drive = google.drive({ version: 'v3', auth });
  } catch (authErr) {
    console.error('[Drive Upload] Google Auth failed:', authErr.message);
    try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
    return res.status(500).json({
      error: `Google Drive authentication error: ${authErr.message}. Verify Service Account credentials.`,
    });
  }

  // Determine target folder ID in Drive
  let targetFolderId;
  try {
    const rootFolderId = await getOrCreateRootFolder(drive);
    targetFolderId = await resolveFolderHierarchy(drive, rootFolderId, pathSegments);
  } catch (folderErr) {
    console.error('[Drive Upload] Folder resolution failed:', folderErr.message);
    try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
    return res.status(500).json({ error: `Failed to resolve target Drive folder: ${folderErr.message}` });
  }

  // Clean filename and stream
  const fileName = (rawFilename || `rotcims_${Date.now()}`).trim();
  const fileStream = fs.createReadStream(tempFilePath);

  let driveFile;
  try {
    const uploadRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [targetFolderId],
      },
      media: {
        mimeType,
        body: fileStream,
      },
      supportsAllDrives: true,
      fields: 'id, name, size, mimeType, webViewLink, thumbnailLink, webContentLink',
    });
    driveFile = uploadRes.data;
  } catch (uploadErr) {
    console.error('[Drive Upload] Upload error:', uploadErr.message);
    return res.status(500).json({ error: `Google Drive upload failed: ${uploadErr.message}` });
  } finally {
    // Clean up temporary local file
    try { if (tempFilePath) fs.unlinkSync(tempFilePath); } catch {}
  }

  // Make file readable to anyone with link (for seamless embedding, thumbnails, and viewing)
  try {
    await drive.permissions.create({
      fileId: driveFile.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  } catch (permErr) {
    console.warn('[Drive Upload] Permissions note:', permErr.message);
  }

  const fileId = driveFile.id;
  const directThumbnail = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  const directPreview = `https://drive.google.com/file/d/${fileId}/preview`;
  const directDownload = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const streamUrl = `/api/drive/file?fileId=${fileId}&action=stream`;
  const webViewLink = driveFile.webViewLink || `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

  return res.status(200).json({
    success: true,
    fileId,
    name: driveFile.name,
    mimeType: driveFile.mimeType,
    size: driveFile.size ? parseInt(driveFile.size, 10) : uploadedFile.size,
    folder: pathSegments.join('/'),
    folderPath: pathSegments,
    directUrl: directThumbnail,
    thumbnailLink: directThumbnail,
    previewUrl: directPreview,
    downloadUrl: directDownload,
    streamUrl,
    webViewLink,
  });
}
