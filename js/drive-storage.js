// =============================================================================
// FILE: js/drive-storage.js
// PURPOSE: Reusable Google Drive + Supabase Client Service for ROTCIMS.
//          Handles file uploads to Google Drive with progress tracking,
//          synchronizes metadata with Supabase PostgreSQL tables,
//          and handles file previews, video streaming, replacements, and deletions.
//
// FOLDER HIERARCHY IN GOOGLE DRIVE:
//   - POSTS/Videos
//   - POSTS/Images
//   - LEARNING_MODULES/PDF
//   - LEARNING_MODULES/WORD
//   - LEARNING_MODULES/EXCEL
//   - LEARNING_MODULES/POWERPOINT
//   - LEARNING_MODULES/VIDEOS
//   - CADET_PHOTOS
//   - CADET_DOCUMENTS
//   - CERTIFICATES
//
// DEPENDS ON: window.supabaseClient (from js/config.js)
// EXPORTS:    window.DriveStorage
// =============================================================================

(function (window) {
  'use strict';

  // API Endpoints (relative for Vercel deployment)
  const DRIVE_API = {
    UPLOAD: '/api/drive/upload',
    DELETE: '/api/drive/delete',
    STATUS: '/api/drive/status',
    FILE:   '/api/drive/file',
  };

  // Helper: Retrieve active Supabase access token
  async function getAccessToken() {
    try {
      if (window.supabaseClient && window.supabaseClient.auth) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        return session?.access_token || null;
      }
    } catch (e) {
      console.warn('[DriveStorage] Session token fetch warning:', e.message);
    }
    return null;
  }

  // Format bytes to human readable string
  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  }

  // Detect appropriate Learning Module subfolder from filename and mime type
  function detectLearningModuleFolder(filename, mimeType = '') {
    const clean = (filename || '').split('?')[0].split('#')[0];
    const ext = clean.split('.').pop().toLowerCase();
    const mime = (mimeType || '').toLowerCase();

    // Word Documents
    if (['doc', 'docx'].includes(ext) || mime.includes('word') || mime.includes('officedocument.wordprocessingml')) {
      return 'LEARNING_MODULES/WORD';
    }
    // Excel Spreadsheets
    if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('sheet') || mime.includes('excel')) {
      return 'LEARNING_MODULES/EXCEL';
    }
    // PowerPoint Presentations
    if (['ppt', 'pptx'].includes(ext) || mime.includes('presentation') || mime.includes('powerpoint')) {
      return 'LEARNING_MODULES/POWERPOINT';
    }
    // Videos
    if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext) || mime.startsWith('video/')) {
      return 'LEARNING_MODULES/VIDEOS';
    }
    // Default: PDF manuals & general docs
    return 'LEARNING_MODULES/PDF';
  }

  const DriveStorage = {
    // ── URL Generator Helpers ────────────────────────────────────────────────
    getThumbnailUrl(fileId, width = 800) {
      if (!fileId) return '';
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
    },

    getPreviewUrl(fileId) {
      if (!fileId) return '';
      return `https://drive.google.com/file/d/${fileId}/preview`;
    },

    getViewUrl(fileId) {
      if (!fileId) return '';
      return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    },

    getDownloadUrl(fileId, fileName = '') {
      if (!fileId) return '';
      if (fileName) {
        return `${DRIVE_API.FILE}?fileId=${fileId}&action=download`;
      }
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    },

    getStreamUrl(fileId) {
      if (!fileId) return '';
      return `${DRIVE_API.FILE}?fileId=${fileId}&action=stream`;
    },

    resolvePhotoUrl(profile) {
      if (!profile) return '';
      if (profile.drive_photo_url) return profile.drive_photo_url;
      if (profile.drive_photo_id) return this.getThumbnailUrl(profile.drive_photo_id);
      if (profile.profile_picture && profile.profile_picture.length > 20) return profile.profile_picture;
      return '';
    },

    detectLearningModuleFolder,
    formatBytes,

    // ── Core Upload Function with Progress Tracking ─────────────────────────
    async uploadFile({ file, folder = 'CADET_DOCUMENTS', fileName = null, onProgress = null }) {
      if (!file) {
        throw new Error('Please select a file to upload.');
      }

      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);
      if (fileName) {
        formData.append('fileName', fileName);
      }

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', DRIVE_API.UPLOAD, true);

        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        // Track upload progress
        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              const percent = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
              onProgress(percent, evt.loaded, evt.total);
            }
          };
        }

        xhr.onload = () => {
          let resData;
          try {
            resData = JSON.parse(xhr.responseText || '{}');
          } catch (e) {
            resData = { error: xhr.responseText || 'Invalid server response' };
          }

          if (xhr.status >= 200 && xhr.status < 300 && resData.success) {
            if (typeof onProgress === 'function') onProgress(100, file.size, file.size);
            resolve(resData);
          } else {
            const errorMsg = resData.error || `Upload failed (Status ${xhr.status})`;
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network connection error while uploading file to Google Drive.'));
        };

        xhr.ontimeout = () => {
          reject(new Error('Upload connection timed out.'));
        };

        xhr.send(formData);
      });
    },

    // ── Core Delete Function ────────────────────────────────────────────────
    async deleteFile(fileId) {
      if (!fileId) return { success: true };

      const token = await getAccessToken();
      const response = await fetch(DRIVE_API.DELETE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fileId }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.success) {
        console.warn('[DriveStorage] Delete warning:', data.error || response.statusText);
      }
      return data;
    },

    // ── Cadet Profile Photo Operations (Folder: CADET_PHOTOS) ───────────────
    async uploadCadetPhoto(file, profileId, oldDrivePhotoId = null, onProgress = null) {
      if (!file) throw new Error('No photo file selected.');

      // 1. Upload photo to Google Drive CADET_PHOTOS folder
      const result = await this.uploadFile({
        file,
        folder: 'CADET_PHOTOS',
        fileName: `cadet_photo_${profileId || Date.now()}_${Date.now()}.${file.name.split('.').pop() || 'jpg'}`,
        onProgress,
      });

      // 2. Synchronize with Supabase profiles table
      if (profileId && window.supabaseClient) {
        const updatePayload = {
          drive_photo_id: result.fileId,
          drive_photo_url: result.directUrl,
          profile_picture: result.directUrl, // Preserves backward compatibility
          updated_at: new Date().toISOString(),
        };

        const { error: dbError } = await window.supabaseClient
          .from('profiles')
          .update(updatePayload)
          .eq('id', profileId);

        if (dbError) {
          console.error('[DriveStorage] Failed to save photo to Supabase profile:', dbError.message);
          throw new Error('Photo uploaded to Google Drive, but database update failed: ' + dbError.message);
        }
      }

      // 3. Remove old photo from Google Drive to prevent orphaned files
      if (oldDrivePhotoId && oldDrivePhotoId !== result.fileId) {
        this.deleteFile(oldDrivePhotoId).catch(err => {
          console.warn('[DriveStorage] Old photo cleanup notice:', err.message);
        });
      }

      return result;
    },

    async removeCadetPhoto(profileId, drivePhotoId = null) {
      if (profileId && window.supabaseClient) {
        const { error } = await window.supabaseClient
          .from('profiles')
          .update({
            drive_photo_id: null,
            drive_photo_url: null,
            profile_picture: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', profileId);

        if (error) throw error;
      }

      if (drivePhotoId) {
        await this.deleteFile(drivePhotoId);
      }

      return { success: true };
    },

    // ── Cadet Documents & Certificates Operations ───────────────────────────
    async uploadCadetDocument({ profileId, file, fileType = 'certificate', description = '', uploadedBy = null, onProgress = null }) {
      if (!profileId) throw new Error('Cadet profile ID is required.');
      if (!file) throw new Error('No document file selected.');

      // Subfolder routing: CERTIFICATES or CADET_DOCUMENTS
      const targetFolder = (fileType === 'certificate') ? 'CERTIFICATES' : 'CADET_DOCUMENTS';

      // 1. Upload to Google Drive
      const result = await this.uploadFile({
        file,
        folder: targetFolder,
        fileName: `${fileType}_${profileId.slice(0, 8)}_${file.name}`,
        onProgress,
      });

      // 2. Insert record in Supabase cadet_files table
      const payload = {
        profile_id: profileId,
        drive_file_id: result.fileId,
        drive_file_url: result.webViewLink || result.previewUrl,
        file_name: file.name,
        file_type: fileType,
        mime_type: file.type || result.mimeType || 'application/octet-stream',
        file_size: file.size || result.size,
        description: description || null,
        uploaded_by: uploadedBy || profileId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (window.supabaseClient) {
        const { data, error } = await window.supabaseClient
          .from('cadet_files')
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error('[DriveStorage] Insert cadet_files error:', error.message);
          throw new Error('File uploaded to Google Drive, but database save failed: ' + error.message);
        }

        return data;
      }

      return { id: 'local_' + Date.now(), ...payload };
    },

    async getCadetFiles(profileId) {
      if (!profileId || !window.supabaseClient) return [];

      const { data, error } = await window.supabaseClient
        .from('cadet_files')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[DriveStorage] getCadetFiles warning:', error.message);
        return [];
      }
      return data || [];
    },

    async deleteCadetFile(cadetFileId, driveFileId) {
      // 1. Delete from Google Drive
      if (driveFileId) {
        await this.deleteFile(driveFileId);
      }

      // 2. Delete from Supabase cadet_files table
      if (cadetFileId && window.supabaseClient && !cadetFileId.startsWith('local_')) {
        const { error } = await window.supabaseClient
          .from('cadet_files')
          .delete()
          .eq('id', cadetFileId);

        if (error) throw error;
      }

      return { success: true };
    },

    // ── Learning Modules Operations (Folder: LEARNING_MODULES/{PDF,WORD,EXCEL,POWERPOINT,VIDEOS})
    async uploadRepositoryDocument({ file, title, description = '', category = 'Learning Modules', accessLevel = 'all', uploadedBy = null, onProgress = null }) {
      if (!file) throw new Error('No document file selected.');

      // Automatically determine correct Learning Module subfolder
      const targetFolder = detectLearningModuleFolder(file.name, file.type);

      // 1. Upload to Google Drive designated folder
      const result = await this.uploadFile({
        file,
        folder: targetFolder,
        fileName: file.name,
        onProgress,
      });

      // 2. Insert into Supabase documents table
      const payload = {
        title: title || file.name,
        description: description || null,
        category: category || 'Learning Modules',
        subject: category || 'General Military Science',
        access_level: accessLevel || 'all',
        drive_file_id: result.fileId,
        drive_file_url: result.webViewLink || result.previewUrl,
        file_path: result.webViewLink || result.directUrl, // For backward compatibility
        file_name: file.name,
        file_type: file.type || result.mimeType || 'application/octet-stream',
        file_size_bytes: file.size || result.size,
        is_published: true,
        uploaded_by: uploadedBy || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (window.supabaseClient) {
        const { data, error } = await window.supabaseClient
          .from('documents')
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error('[DriveStorage] Insert documents error:', error.message);
          throw new Error('File uploaded to Google Drive, but database save failed: ' + error.message);
        }

        return data;
      }

      return { id: 'local_' + Date.now(), ...payload };
    },

    async deleteRepositoryDocument(docId, driveFileId) {
      // 1. Delete from Google Drive
      if (driveFileId) {
        await this.deleteFile(driveFileId);
      }

      // 2. Delete from Supabase documents table
      if (docId && window.supabaseClient && !docId.startsWith('local_')) {
        const { error } = await window.supabaseClient
          .from('documents')
          .delete()
          .eq('id', docId);

        if (error) throw error;
      }

      return { success: true };
    },

    // ── Command Posts Media Operations (Folders: POSTS/Images, POSTS/Videos) ──
    async uploadPostMedia({ file, type = 'image', onProgress = null }) {
      if (!file) throw new Error('No media file selected.');

      const isVideo = type === 'video' || (file.type && file.type.startsWith('video/')) || /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name);
      const targetFolder = isVideo ? 'POSTS/Videos' : 'POSTS/Images';

      const result = await this.uploadFile({
        file,
        folder: targetFolder,
        fileName: `post_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        onProgress,
      });

      return {
        ...result,
        isVideo,
        targetFolder,
      };
    },

    // ── Diagnostic / Status Check ───────────────────────────────────────────
    async checkStatus() {
      try {
        const res = await fetch(DRIVE_API.STATUS);
        if (!res.ok) return { ok: false, message: `Status HTTP ${res.status}` };
        return await res.json();
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
  };

  window.DriveStorage = DriveStorage;
})(window);
