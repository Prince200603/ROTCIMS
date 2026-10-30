/**
 * ============================================================================
 * FILE: js/rbac.js
 * PROJECT: ROTCIMS — San Enrique ROTC
 * PURPOSE: Centralized Role-Based Access Control (RBAC) & Position Governance.
 * 
 * POSITIONS & CAPABILITIES (Section 5 Matrix):
 *   • Admin               - Full control
 *   • S1 Adjutant         - Access to Reports & Modules; other sections view-only
 *   • S3 Operations       - Access to Attendance Reports; other sections view-only
 *   • S7 CMO              - Access to Posting Center (create/manage posts)
 *   • Company Commanders  - View-only by default (Company-level records)
 *   • Executive Officer   - View-only by default across authorized sections
 *   • Deputy Positions    - View-only by default (Deputy S1, S2, S3, S4, S7)
 *   • Platoon Leaders     - Live QR Scanner access (strictly for assigned platoon)
 *   • Default / Others    - Strict View-Only Access
 * ============================================================================
 */

const RBAC = {

  // Approved Class-to-Position Mapping (Section 3 of Specification)
  CLASS_POSITIONS: {
    '1st_class_officer': [
      'Alpha Company Commander',
      'Bravo Company Commander',
      'Charlie Company Commander',
      'Executive Officer',
      'S1 Adjutant',
      'S2 Intelligence',
      'S3 Operations',
      'S4 Supply',
      'S7 CMO'
    ],
    '2nd_class_officer': [
      'Deputy S1',
      'Deputy S2',
      'Deputy S3',
      'Deputy S4',
      'Deputy S7',
      'Platoon Leader'
    ],
    '3rd_class_officer': [
      'Deputy S1',
      'Deputy S2',
      'Deputy S3',
      'Deputy S4',
      'Deputy S7',
      'Platoon Leader'
    ],
    '4th_class_officer': [
      'Deputy S1',
      'Deputy S2',
      'Deputy S3',
      'Deputy S4',
      'Deputy S7',
      'Platoon Leader'
    ],
    'advance_officer': [
      'Deputy S1',
      'Deputy S2',
      'Deputy S3',
      'Deputy S4',
      'Deputy S7',
      'Platoon Leader'
    ]
  },

  CLASS_LABELS: {
    '1st_class_officer': '1st Class Officer',
    '2nd_class_officer': '2nd Class Officer',
    '3rd_class_officer': '3rd Class Officer',
    '4th_class_officer': '4th Class Officer',
    'advance_officer':   'Advance Officer'
  },

  /**
   * Retrieves positions allowed for a specific officer class.
   */
  getPositionsForClass(officerClass) {
    return this.CLASS_POSITIONS[officerClass] || [];
  },

  /**
   * Validates if a given position is allowed for the given class.
   */
  isValidClassPosition(officerClass, position) {
    const allowed = this.getPositionsForClass(officerClass);
    return allowed.includes(position);
  },

  /**
   * Fetches active officer classification and position for a user.
   */
  async getOfficerProfile(profileId) {
    if (!profileId || !window.supabaseClient) return null;
    try {
      const { data, error } = await window.supabaseClient
        .from('officer_classifications')
        .select('id, profile_id, officer_class, officer_position, company, platoon, is_active')
        .eq('profile_id', profileId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.warn('RBAC.getOfficerProfile note:', error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.warn('RBAC.getOfficerProfile error:', err);
      return null;
    }
  },

  /**
   * Computes capability flags based on role and officer position.
   */
  getCapabilities(userProfile, officerRecord) {
    const isSystemAdmin = userProfile?.role === 'admin';
    const position = officerRecord?.officer_position || '';
    const officerClass = officerRecord?.officer_class || '';
    const isActive = officerRecord?.is_active !== false;

    // Default Capabilities: Deny all privileged actions
    const caps = {
      isAdmin:                   isSystemAdmin,
      isOfficer:                 !!officerRecord && isActive,
      officerClass:              officerClass,
      position:                  position,
      assignedCompany:           officerRecord?.company || userProfile?.company || '',
      assignedPlatoon:           officerRecord?.platoon || userProfile?.platoon || '',

      // Administration capabilities (Admin Only)
      canCreateOfficerAccounts:  isSystemAdmin,
      canManageOfficerProfiles:  isSystemAdmin,
      canManageCadetAccounts:    isSystemAdmin,
      canManageSystemSettings:   isSystemAdmin,
      canCreateAttendanceSession:isSystemAdmin,
      canOpenCloseSession:       isSystemAdmin,
      canConfigureScannerPolicy: isSystemAdmin,
      canMarkAttendanceManually: isSystemAdmin,
      canEditAttendanceRecords:  isSystemAdmin,

      // Delegated Operational Capabilities
      canScanAttendanceQR:       isSystemAdmin || (position === 'Platoon Leader' && isActive),
      canManagePostingCenter:    isSystemAdmin || (position === 'S7 CMO' && isActive),
      canAccessReports:          isSystemAdmin || ['S1 Adjutant', 'S3 Operations', 'Alpha Company Commander', 'Bravo Company Commander', 'Charlie Company Commander', 'Executive Officer'].includes(position),
      canAccessModules:          isSystemAdmin || ['S1 Adjutant', 'Executive Officer'].includes(position),

      // View-only flags per section
      isViewOnlyReports:         !isSystemAdmin, // Only admin can edit/correct records in reports
      isViewOnlyPosting:         !isSystemAdmin && position !== 'S7 CMO',
      isViewOnlyModules:         !isSystemAdmin,
      isViewOnlySessions:        !isSystemAdmin
    };

    return caps;
  },

  /**
   * Applies UI restrictions to the current page based on officer position.
   * Disables or hides buttons, displays View-Only indicator, etc.
   */
  async applyUIRestrictions(pageKey) {
    const currentUser = window.Auth?.currentUser || await window.Auth?.getUser();
    if (!currentUser) return;

    const profile = await window.Auth?.getProfile();
    if (!profile) return;

    if (profile.role === 'admin') {
      // Full administrative privileges — no restrictions applied
      return;
    }

    const officerRecord = await this.getOfficerProfile(profile.id);
    const caps = this.getCapabilities(profile, officerRecord);

    // Update top bar with Officer Position if assigned
    const roleTagEl = document.getElementById('user-role');
    if (roleTagEl && caps.position) {
      roleTagEl.textContent = caps.position.toUpperCase();
      roleTagEl.title = `${caps.officerClass ? this.CLASS_LABELS[caps.officerClass] + ' • ' : ''}${caps.position}`;
    }

    // Apply Page-Specific Restrictions
    switch (pageKey) {

      // Attendance Management (admin-attendance.html)
      case 'attendance':
        // Hide Admin-Only session creation and edit buttons
        const btnNewSess = document.getElementById('btn-new-session');
        const btnEditSess = document.getElementById('btn-edit-session');
        const btnDeleteSess = document.getElementById('btn-delete-session');
        const btnManualEntry = document.getElementById('btn-manual-entry');
        if (btnNewSess) btnNewSess.style.display = 'none';
        if (btnEditSess) btnEditSess.style.display = 'none';
        if (btnDeleteSess) btnDeleteSess.style.display = 'none';
        if (btnManualEntry) btnManualEntry.style.display = 'none';

        // Restrict QR Scanner button if not Platoon Leader or Admin
        const btnOpenScanner = document.getElementById('btn-open-scanner');
        if (btnOpenScanner && !caps.canScanAttendanceQR) {
          btnOpenScanner.style.display = 'none';
        }

        // Add View-Only banner to table actions
        this.injectViewOnlyBanner('attendance-view-banner', 'Drill Sessions & Records are View-Only for this officer position.');
        break;

      // Attendance Reports (admin-reports.html)
      case 'reports':
        // S1 Adjutant and S3 Operations can view reports; editing records remains Admin-only
        document.querySelectorAll('.btn-edit-attendance, .btn-delete-attendance').forEach(el => el.style.display = 'none');
        break;

      // Posting Center (admin-posting.html)
      case 'posting':
        if (!caps.canManagePostingCenter) {
          // Hide post creation controls for positions other than S7 CMO and Admin
          const createPostCard = document.getElementById('create-post-card') || document.querySelector('.posting-form-card');
          if (createPostCard) createPostCard.style.display = 'none';
          document.querySelectorAll('.btn-delete-post, .btn-edit-post').forEach(b => b.style.display = 'none');
          this.injectViewOnlyBanner('posting-view-banner', 'Official Postings are View-Only for your position.');
        }
        break;

      // Modules & Doctrine (admin-documents.html)
      case 'documents':
        // S1 Adjutant can view modules; publishing/uploading remains Admin-only
        const uploadForm = document.getElementById('form-upload-document') || document.getElementById('btn-upload-doc');
        if (uploadForm) uploadForm.style.display = 'none';
        document.querySelectorAll('.btn-delete-doc').forEach(b => b.style.display = 'none');
        break;

      // Personnel & Roles (admin-accounts.html)
      case 'accounts':
        // Non-admins cannot create officers or promote users
        const btnCreateOff = document.getElementById('btn-create-officer-nav');
        if (btnCreateOff) btnCreateOff.style.display = 'none';
        document.querySelectorAll('.btn-assign-officer, select[onchange*="changeRole"]').forEach(el => el.disabled = true);
        this.injectViewOnlyBanner('accounts-view-banner', 'Personnel and Role Governance is strictly reserved for the Commandant / Administrator.');
        break;
    }
  },

  /**
   * Helper to display a clean View-Only notice badge at the top of a page section.
   */
  injectViewOnlyBanner(elementId, message) {
    if (document.getElementById(elementId)) return;
    const banner = document.createElement('div');
    banner.id = elementId;
    banner.style.cssText = 'background: rgba(184, 142, 44, 0.12); border: 1px solid rgba(184, 142, 44, 0.35); color: #b88e2c; padding: 0.65rem 1.25rem; border-radius: 10px; font-size: 0.82rem; font-weight: 600; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;';
    banner.innerHTML = `<i class="fa-solid fa-eye" style="color: #b88e2c;"></i> <span>${message}</span>`;
    
    const contentBody = document.querySelector('.content-body') || document.querySelector('.main-content');
    if (contentBody) contentBody.insertBefore(banner, contentBody.firstChild);
  },

  /**
   * Audit logging helper (logs sensitive operations into audit_logs table).
   */
  async logAudit(action, targetId = null, details = {}) {
    if (!window.supabaseClient) return;
    try {
      const user = await window.Auth?.getUser();
      const profile = await window.Auth?.getProfile();
      await window.supabaseClient.from('audit_logs').insert({
        actor_id:  profile?.id || null,
        action:    action,
        target_id: targetId ? String(targetId) : null,
        details:   { ...details, user_email: user?.email, timestamp: new Date().toISOString() }
      });
    } catch (e) {
      console.warn('Audit log notice:', e);
    }
  }
};

window.RBAC = RBAC;

