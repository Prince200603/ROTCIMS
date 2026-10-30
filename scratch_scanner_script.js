
    // html5QrCode — the active scanner instance (null when stopped)
    let html5QrCode = null;
    // isScanning — tracks camera on/off state to toggle the button label
    let isScanning = false;
    // currentOfficer — the logged-in user's profile, stored after requireAuth()
    let currentOfficer = null;
    // scannedCount — running total of successful scans for the counter badge
    let scannedCount = 0;
    // scannedCadetIds — Set of cadet UUIDs already scanned THIS session.
    // Prevents double-counting if the same badge is accidentally scanned twice.
    const scannedCadetIds = new Set();
    // currentFacingMode — track active camera (rear = "environment", front = "user")
    let currentFacingMode = "environment";

    // ── popupDismissTimer — timer handle for auto-close of success popup ──
    let popupDismissTimer = null;

    // ── playBeep(type) ────────────────────────────────────────────────────
    // Generates a short beep using the Web Audio API.
    // type: 'success' → double ascending beep (✅)
    //       'error'   → low buzz (❌)
    //       'warning' → single mid beep (⚠️)
    // No audio file required — synthesised on the fly.
    function playBeep(type = 'success') {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const play = (freq, startTime, duration, vol = 0.4) => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        const t = ctx.currentTime;
        if (type === 'success') {
          // Double ascending beep — cheerful confirm tone
          play(880, t,        0.12);   // A5
          play(1175, t + 0.15, 0.18);  // D6
        } else if (type === 'warning') {
          // Single mid-pitch beep
          play(660, t, 0.2);           // E5
        } else {
          // Low buzz for error
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(180, t);
          gain.gain.setValueAtTime(0.3, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
          osc.start(t);
          osc.stop(t + 0.25);
        }
      } catch (e) {
        // Web Audio not supported — silently ignore
        console.warn('Audio not supported:', e);
      }
    }

    // ── showSuccessPopup(cadetProfile, timeString) ────────────────────────
    // Displays the floating success result card (Screen 3) for 3.5s, then auto-closes.
    function showSuccessPopup(cadetProfile, timeString) {
      const popup = document.getElementById('scan-success-popup');
      if (!popup) return;

      const first = cadetProfile.first_name || '';
      const last = cadetProfile.last_name || 'Cadet';
      const initials = ((first[0] || '') + (last[0] || 'C')).toUpperCase();
      const avatarEl = document.getElementById('popup-avatar');
      if (avatarEl) avatarEl.textContent = initials;

      const nameEl = document.getElementById('popup-cadet-name');
      if (nameEl) nameEl.textContent = `Cadet ${last}, ${first}`;

      const metaEl = document.getElementById('popup-cadet-meta');
      const studentId = cadetProfile.student_id || 'SE-2026-XXX';
      const platoon = cadetProfile.platoon || cadetProfile.section || cadetProfile.company || '1st Platoon';
      if (metaEl) metaEl.textContent = `${studentId} • ${platoon}`;

      const timeEl = document.getElementById('popup-scan-time');
      if (timeEl) timeEl.textContent = timeString;

      // Reset and animate the progress bar drain
      const bar = document.getElementById('popup-progress-bar');
      if (bar) {
        bar.style.transition = 'none';
        bar.style.width = '100%';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bar.style.transition = 'width 3.5s linear';
            bar.style.width = '0%';
          });
        });
      }

      // Show the popup
      popup.classList.add('active');

      // Auto-dismiss after 3.5 seconds
      if (popupDismissTimer) clearTimeout(popupDismissTimer);
      popupDismissTimer = setTimeout(closeSuccessPopup, 3500);
    }

    // ── closeSuccessPopup() ───────────────────────────────────────────────
    function closeSuccessPopup() {
      const popup = document.getElementById('scan-success-popup');
      if (popup) popup.classList.remove('active');
      if (popupDismissTimer) { clearTimeout(popupDismissTimer); popupDismissTimer = null; }
    }

    // ── refreshFeed() ─────────────────────────────────────────────────────
    // Manually re-loads scan records from Supabase for the current session.
    // Useful when using multiple devices (phone scans appear on PC view).
    async function refreshFeed() {
      const sessionId = document.getElementById("session-select")?.value;
      if (!sessionId) return;
      const icon = document.getElementById("refresh-icon");
      if (icon) icon.classList.add("fa-spin");
      await loadSessionScans(sessionId);
      if (icon) setTimeout(() => icon.classList.remove("fa-spin"), 500);
    }

    document.addEventListener("DOMContentLoaded", async () => {
      // ── SECURITY GUARD ──────────────────────────────────────────────────
      // requireAuth redirects to login if no valid session or wrong role.
      // We store the profile so we can record 'recorded_by' in the DB insert.
      currentOfficer = await Auth.requireAuth(["admin", "personnel", "platoon_leader"]);
      if (!currentOfficer) return;

      // ── HTTPS Context Check on Page Load ──────────────────────────────────
      // Proactively show the warning banner if page is not in a secure context.
      // This avoids the user clicking "Start Camera" and getting a confusing error.
      const isSecureCtx = window.isSecureContext ||
                          location.hostname === 'localhost' ||
                          location.hostname === '127.0.0.1';

      if (!isSecureCtx) {
        const banner = document.getElementById("https-warning-banner");
        if (banner) banner.style.display = "block";

        const scanBtn = document.getElementById("btn-toggle-scan");
        if (scanBtn) {
          scanBtn.title = "Camera requires HTTPS. See warning above.";
          scanBtn.style.opacity = "0.6";
          // Don't disable — let them click it for a clear message, just warn visually
        }

        const statusText = document.getElementById("scanner-status");
        if (statusText) {
          statusText.innerHTML = '<i class="fa-solid fa-lock-open" style="color: #dc2626;"></i> <strong style="color: #dc2626;">Camera unavailable (HTTPS required)</strong> — See the red warning above. Use image upload or manual entry in the meantime.';
        }
      }

      // Auto-sync missing cadets table rows in background
      syncMissingCadets();

      // Load drill sessions into the dropdown
      await loadSessions();

      // Wire up the Start/Stop button
      document.getElementById("btn-toggle-scan").addEventListener("click", toggleScanner);
    });

    // ── syncMissingCadets() ──────────────────────────────────────────────
    // Auto-generates cadets table rows for any cadet profiles missing one.
    // This prevents foreign key errors in the QR scanner and attendance logs.
    async function syncMissingCadets() {
      try {
        const { data: profs } = await window.supabaseClient
          .from("profiles")
          .select("id, company, platoon, role")
          .eq("role", "cadet");

        if (profs && profs.length > 0) {
          for (const p of profs) {
            const { data: existing } = await window.supabaseClient
              .from("cadets")
              .select("id")
              .eq("profile_id", p.id)
              .maybeSingle();

            if (!existing) {
              await window.supabaseClient
                .from("cadets")
                .insert({
                  profile_id: p.id,
                  rotc_unit: p.company || "Alpha Company",
                  rank: "Cadet"
                });
            }
          }
        }
      } catch (e) {
        console.warn("syncMissingCadets note:", e);
      }
    }

    // allSessions — holds all fetched session records so we can edit/toggle/delete them
    let allSessions = [];

    // ── loadSessions() ───────────────────────────────────────────────────
    // Queries attendance_sessions ordered by date (newest first).
    // Open sessions (is_open = true) receive the 'selected' attribute so
    // the officer doesn't have to pick manually for today's drill.
    async function loadSessions() {
      const select = document.getElementById("session-select");
      try {
        const { data: sessions, error } = await window.supabaseClient
          .from("attendance_sessions")
          .select("id, title, session_date, is_open, start_time, end_time, location")
          .order("session_date", { ascending: false });

        if (error || !sessions || sessions.length === 0) {
          allSessions = [];
          select.innerHTML = '<option value="">No sessions available (Create one first)</option>';
          onSessionSelectionChanged();
          return;
        }

        allSessions = sessions;

        // Find active open session or default to the first one
        const activeIdx = sessions.findIndex(s => s.is_open);
        const selectedId = activeIdx >= 0 ? sessions[activeIdx].id : sessions[0].id;

        // Render each session as an <option>.
        // The 🟢 / ⚪ emoji visually distinguishes open vs. closed sessions.
        select.innerHTML = sessions.map(s => `
          <option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>
            ${s.is_open ? '🟢 [OPEN]' : '⚪ [CLOSED]'} ${s.title} (${s.session_date})
          </option>
        `).join('');

        onSessionSelectionChanged();
      } catch (err) {
        console.error(err);
      }
    }

    // ── onSessionSelectionChanged() ─────────────────────────────────────
    // Updates UI status badge and Close/Open button according to currently picked session.
    // Also loads existing scan records from Supabase so the feed is always in sync
    // across all devices (phone scan shows up on PC view and vice versa).
    function onSessionSelectionChanged() {
      const select = document.getElementById("session-select");
      const currentId = select ? select.value : null;
      const session = allSessions.find(s => s.id === currentId);
      const badge = document.getElementById("session-status-badge");
      const toggleBtn = document.getElementById("btn-toggle-session-open");

      if (!session) {
        if (badge) {
          badge.textContent = "⚪ NONE";
          badge.className = "badge";
          badge.style.background = "#94a3b8";
        }
        if (toggleBtn) {
          toggleBtn.disabled = true;
          toggleBtn.innerHTML = '<i class="fa-solid fa-ban"></i> No Session';
        }
        return;
      }

      if (toggleBtn) toggleBtn.disabled = false;

      if (session.is_open) {
        if (badge) {
          badge.textContent = "🟢 OPEN";
          badge.className = "badge badge-approved";
          badge.style.background = "";
        }
        if (toggleBtn) {
          toggleBtn.className = "btn btn-sm btn-outline";
          toggleBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Close Session';
          toggleBtn.title = "Click to CLOSE this session (locks QR scanning)";
        }
      } else {
        if (badge) {
          badge.textContent = "⚪ CLOSED";
          badge.className = "badge";
          badge.style.background = "#64748b";
          badge.style.color = "#ffffff";
        }
        if (toggleBtn) {
          toggleBtn.className = "btn btn-sm btn-brass";
          toggleBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i> Reopen Session';
          toggleBtn.title = "Click to OPEN this session for active QR scanning";
        }
      }

      // Load existing attendance records for this session from Supabase.
      // This syncs the feed across all devices — phone scans appear on PC too.
      if (currentId) loadSessionScans(currentId);
    }

    // ── loadSessionScans(sessionId) ──────────────────────────────────────
    // Fetches all attendance_records for the selected session from Supabase,
    // then populates the live feed table and updates the scan counter.
    // This ensures multi-device sync: scans done on phone show up on PC.
    async function loadSessionScans(sessionId) {
      try {
        // Reset in-memory state for this session
        scannedCadetIds.clear();
        scannedCount = 0;

        const tbody = document.getElementById("scan-feed-tbody");
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--slate);">
          <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--brass);"></i> Loading session records...
        </td></tr>`;

        // Join attendance_records → cadets → profiles to get display info
        const { data: records, error } = await window.supabaseClient
          .from("attendance_records")
          .select(`
            id, status, scanned_at,
            cadets (
              id, profile_id,
              profiles ( first_name, last_name, student_id, company, platoon )
            )
          `)
          .eq("session_id", sessionId)
          .order("scanned_at", { ascending: false });

        if (error) throw error;

        const mobList = document.getElementById("scan-feed-mobile-list");

        if (!records || records.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--slate);">
            No cadets scanned in this session yet.
          </td></tr>`;
          if (mobList) {
            mobList.innerHTML = `<div style="text-align:center; padding:1.25rem; color:var(--slate); font-size:0.84rem;">
              No cadets scanned in this session yet.
            </div>`;
          }
          document.getElementById("scan-counter").textContent = "0 Cadets Marked";
          return;
        }

        // Build the feed table rows and mobile card items
        tbody.innerHTML = "";
        if (mobList) mobList.innerHTML = "";

        records.forEach(rec => {
          const profile = rec.cadets?.profiles || {};
          const cadetId = rec.cadets?.id;
          const timeStr = rec.scanned_at
            ? new Date(rec.scanned_at).toLocaleTimeString('en-PH', { hour12: false })
            : "—";
          const name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || "Unknown";
          const studentId = profile.student_id || "—";
          const unit = profile.company || "Unassigned";

          // Add to in-memory set so re-scans are blocked on this device too
          if (cadetId) scannedCadetIds.add(cadetId);

          // 1. Desktop table row
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td style="font-family:monospace;">${timeStr}</td>
            <td><strong>${name}</strong></td>
            <td style="font-family:monospace;">${studentId}</td>
            <td><span class="badge badge-admin">${unit}</span></td>
            <td><span class="badge badge-approved">PRESENT</span></td>
          `;
          tbody.appendChild(tr);

          // 2. Mobile card item
          if (mobList) {
            const card = document.createElement("div");
            card.className = "scan-card-item";
            card.innerHTML = `
              <div class="avatar-sm">${getInitials(name)}</div>
              <div class="card-info">
                <div class="card-name">${name}</div>
                <div class="card-meta">
                  <span style="font-family: monospace; font-weight:600;">${studentId}</span>
                  <span>&bull;</span>
                  <span>${unit}</span>
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <div class="card-time">${timeStr}</div>
                <span class="scan-card-present"><i class="fa-solid fa-check"></i> PRESENT</span>
              </div>
            `;
            mobList.appendChild(card);
          }
        });

        // Update scanned count from actual DB records
        scannedCount = records.length;
        document.getElementById("scan-counter").textContent = `${scannedCount} Cadets Marked`;

      } catch (err) {
        console.error("Failed to load session scans:", err);
        document.getElementById("scan-feed-tbody").innerHTML = `
          <tr><td colspan="5" style="text-align:center; padding:1rem; color:#dc2626;">
            ⚠️ Could not load session records: ${err.message}
          </td></tr>`;
      }
    }

    // ── toggleSelectedSessionOpen() ──────────────────────────────────────
    // Toggles is_open state between true and false in Supabase
    async function toggleSelectedSessionOpen() {
      const select = document.getElementById("session-select");
      const currentId = select ? select.value : null;
      const session = allSessions.find(s => s.id === currentId);
      if (!session) {
        alert("Please select a session first.");
        return;
      }

      const nextState = !session.is_open;
      const actionName = nextState ? "OPEN" : "CLOSE";
      if (!confirm(`Are you sure you want to ${actionName} session "${session.title}"?`)) {
        return;
      }

      try {
        const { error } = await window.supabaseClient
          .from("attendance_sessions")
          .update({ is_open: nextState })
          .eq("id", session.id);

        if (error) throw error;

        session.is_open = nextState;
        showAlert("success", `Session is now ${nextState ? '🟢 OPEN for scans' : '⚪ CLOSED (locked)'}.`);
        await loadSessions();
        if (select) select.value = session.id;
        onSessionSelectionChanged();
      } catch (err) {
        console.error("Failed to toggle session:", err);
        alert("Error updating session status: " + err.message);
      }
    }

    // ── openCreateSessionModal() ─────────────────────────────────────────
    function openCreateSessionModal() {
      document.getElementById("modal-session-title-heading").innerHTML = '<i class="fa-solid fa-calendar-check" style="color:var(--brass);"></i> Create Formation Drill Session';
      document.getElementById("sess-edit-id").value = "";
      document.getElementById("sess-title").value = "";
      document.getElementById("sess-date").value = new Date().toISOString().split('T')[0];
      document.getElementById("sess-location").value = "Grandstand Parade Grounds";
      document.getElementById("sess-start").value = "07:00";
      document.getElementById("sess-end").value = "12:00";
      document.getElementById("sess-is-open").checked = true;
      document.getElementById("modal-manage-session").classList.add("active");
    }

    // ── openEditSessionModal() ───────────────────────────────────────────
    function openEditSessionModal() {
      const select = document.getElementById("session-select");
      const currentId = select ? select.value : null;
      const session = allSessions.find(s => s.id === currentId);
      if (!session) {
        alert("Please select a session to edit.");
        return;
      }

      document.getElementById("modal-session-title-heading").innerHTML = '<i class="fa-solid fa-pen-to-square" style="color:var(--brass);"></i> Edit Formation Drill Session';
      document.getElementById("sess-edit-id").value = session.id;
      document.getElementById("sess-title").value = session.title || "";
      document.getElementById("sess-date").value = session.session_date || "";
      document.getElementById("sess-location").value = session.location || "";
      document.getElementById("sess-start").value = session.start_time || "07:00";
      document.getElementById("sess-end").value = session.end_time || "12:00";
      document.getElementById("sess-is-open").checked = !!session.is_open;
      document.getElementById("modal-manage-session").classList.add("active");
    }

    // ── closeSessionModal() ──────────────────────────────────────────────
    function closeSessionModal() {
      document.getElementById("modal-manage-session").classList.remove("active");
    }

    // ── handleSaveSession(e) ─────────────────────────────────────────────
    async function handleSaveSession(e) {
      e.preventDefault();
      const saveBtn = document.getElementById("btn-save-session");
      if (saveBtn) saveBtn.disabled = true;

      const editId = document.getElementById("sess-edit-id").value.trim();
      const title = document.getElementById("sess-title").value.trim();
      const session_date = document.getElementById("sess-date").value;
      const location = document.getElementById("sess-location").value.trim();
      const start_time = document.getElementById("sess-start").value;
      const end_time = document.getElementById("sess-end").value;
      const is_open = document.getElementById("sess-is-open").checked;

      const fullPayload = {
        title,
        session_date,
        location: location || null,
        start_time: start_time || null,
        end_time: end_time || null,
        is_open,
        status: is_open ? "active" : "closed"
      };

      try {
        let error = null;
        if (editId) {
          // UPDATE
          const res = await window.supabaseClient
            .from("attendance_sessions")
            .update(fullPayload)
            .eq("id", editId);
          error = res.error;

          // Schema cache fallback if optional columns fail
          if (error && (error.message.includes("end_time") || error.message.includes("location") || error.message.includes("status"))) {
            const basePayload = { title, session_date, is_open };
            const retryRes = await window.supabaseClient
              .from("attendance_sessions")
              .update(basePayload)
              .eq("id", editId);
            error = retryRes.error;
          }
        } else {
          // INSERT
          fullPayload.created_by = currentOfficer?.id || null;
          const res = await window.supabaseClient
            .from("attendance_sessions")
            .insert(fullPayload)
            .select();
          error = res.error;

          if (error && (error.message.includes("end_time") || error.message.includes("location") || error.message.includes("status"))) {
            const basePayload = {
              title,
              session_date,
              is_open,
              created_by: currentOfficer?.id || null
            };
            const retryRes = await window.supabaseClient
              .from("attendance_sessions")
              .insert(basePayload)
              .select();
            error = retryRes.error;
          }
        }

        if (error) throw error;

        closeSessionModal();
        showAlert("success", `Formation session successfully ${editId ? 'updated' : 'created'}!`);
        await loadSessions();
        if (editId) {
          const select = document.getElementById("session-select");
          if (select) select.value = editId;
          onSessionSelectionChanged();
        }
      } catch (err) {
        console.error("Save session failed:", err);
        alert("Failed to save session: " + err.message);
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    }

    // ── deleteSelectedSession() ──────────────────────────────────────────
    async function deleteSelectedSession() {
      const select = document.getElementById("session-select");
      const currentId = select ? select.value : null;
      const session = allSessions.find(s => s.id === currentId);
      if (!session) {
        alert("Please select a session to delete.");
        return;
      }

      if (!confirm(`⚠️ DANGER: Delete Session "${session.title}" (${session.session_date})?\n\nThis will permanently delete this formation drill session and all associated attendance records recorded under it.`)) {
        return;
      }

      try {
        // First delete any linked attendance records to satisfy foreign keys
        await window.supabaseClient
          .from("attendance_records")
          .delete()
          .eq("session_id", session.id);

        // Then delete the session itself
        const { error } = await window.supabaseClient
          .from("attendance_sessions")
          .delete()
          .eq("id", session.id);

        if (error) throw error;

        showAlert("warning", `Session "${session.title}" was deleted.`);
        await loadSessions();
      } catch (err) {
        console.error("Failed to delete session:", err);
        alert("Error deleting session: " + err.message);
      }
    }

    // ── toggleScanner() ──────────────────────────────────────────────────
    // Starts or stops the camera depending on current isScanning state.
    async function toggleScanner() {
      const btn = document.getElementById("btn-toggle-scan");
      const statusText = document.getElementById("scanner-status");

      if (isScanning) {
        // Camera is running — stop it and reset the button UI
        if (html5QrCode) {
          try { await html5QrCode.stop(); } catch (e) { /* ignore stop errors */ }
        }
        isScanning = false;
        btn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera Scanner';
        btn.className = "btn btn-primary";
        statusText.innerHTML = '<i class="fa-solid fa-circle-info" style="color: var(--brass);"></i> Camera stopped. Click Start Camera to resume.';
        return;
      }

      // Validate that the officer chose a session before opening the camera
      const sessionId = document.getElementById("session-select").value;
      if (!sessionId) {
        alert("Please select an attendance session before scanning.");
        return;
      }

      // ── HTTPS Security Context Check ─────────────────────────────────────
      // Browsers block getUserMedia (camera) on non-secure origins (plain http://)
      // EXCEPT for localhost which is always treated as secure.
      // If we detect a non-secure context, show the warning banner immediately.
      const isSecure = window.isSecureContext ||
                       location.hostname === 'localhost' ||
                       location.hostname === '127.0.0.1';

      if (!isSecure) {
        // Show the HTTPS warning banner
        const banner = document.getElementById("https-warning-banner");
        if (banner) banner.style.display = "block";
        statusText.innerHTML = '<i class="fa-solid fa-lock-open" style="color: #dc2626;"></i> <strong style="color: #dc2626;">Camera blocked — HTTPS required.</strong> Use the image upload or manual entry below, or see the warning above for how to enable camera.';
        return;
      }

      // ── Attempt Camera Start ──────────────────────────────────────────────
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Starting Camera...';
      btn.disabled = true;
      statusText.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--brass);"></i> Requesting camera access...';

      try {
        // Create a new Html5Qrcode instance targeting the #qr-reader div
        if (html5QrCode) {
          try { await html5QrCode.stop(); } catch (e) { /* ignore */ }
        }
        html5QrCode = new Html5Qrcode("qr-reader");

        // fps: 10 = scan attempts per second; qrbox defines the green scan square
        const config = { fps: 10, qrbox: { width: 260, height: 260 } };

        // First try rear camera (environment), then fall back to any camera
        let started = false;
        try {
          // facingMode: "environment" requests the rear-facing camera on mobile
          await html5QrCode.start(
            { facingMode: "environment" },
            config,
            onScanSuccess,
            onScanFailure
          );
          started = true;
        } catch (rearErr) {
          // Rear camera failed — try front / any available camera
          try {
            await html5QrCode.start(
              { facingMode: "user" },
              config,
              onScanSuccess,
              onScanFailure
            );
            started = true;
          } catch (anyErr) {
            throw anyErr; // re-throw to outer catch
          }
        }

        if (started) {
          isScanning = true;
          btn.innerHTML = '<i class="fa-solid fa-stop-circle"></i> Stop Camera';
          btn.className = "btn btn-danger";
          btn.disabled = false;
          statusText.innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #22c55e; animation: pulse 1.5s ease-in-out infinite;"></i> <strong>Camera active.</strong> Align cadet QR badge in the green viewfinder box.';
        }
      } catch (err) {
        console.error("Camera start error:", err);
        btn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera Scanner';
        btn.className = "btn btn-primary";
        btn.disabled = false;

        // Classify the error type and show appropriate message
        const msg = (err && (err.message || err.toString() || '')).toLowerCase();
        const banner = document.getElementById("https-warning-banner");

        if (
          msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed') ||
          msg.includes('secure') || msg.includes('https') || msg.includes('insecure') ||
          !isSecure
        ) {
          // Permission denied or HTTPS issue
          if (banner) banner.style.display = "block";
          statusText.innerHTML = '<i class="fa-solid fa-lock-open" style="color: #dc2626;"></i> <strong style="color: #dc2626;">Camera Permission Denied.</strong> Either allow camera in your browser settings, or use the HTTPS tunnel method shown in the banner above.';
        } else if (msg.includes('notfound') || msg.includes('no camera') || msg.includes('devicenotfound')) {
          statusText.innerHTML = '<i class="fa-solid fa-video-slash" style="color: #dc2626;"></i> <strong style="color: #dc2626;">No camera device found.</strong> This device has no accessible camera. Use the image upload or manual entry below.';
        } else if (msg.includes('inuse') || msg.includes('trackstarterror') || msg.includes('device already')) {
          statusText.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #d97706;"></i> Camera is in use by another app. Close other tabs or apps using the camera and try again.';
        } else {
          // Generic fallback — also show HTTPS banner as a likely cause
          if (banner) banner.style.display = "block";
          statusText.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #dc2626;"></i> Camera error: ' + (err.message || 'Unknown error') + '. See the banner above for solutions.';
        }
      }
    }

    // ── flipCamera() ─────────────────────────────────────────────────────
    // Seamlessly switches between front and rear cameras on mobile phones
    async function flipCamera() {
      if (!isScanning || !html5QrCode) {
        showAlert("warning", "Please tap 'Start Camera Scanner' first before flipping.");
        return;
      }
      const flipBtn = document.getElementById("btn-flip-cam");
      if (flipBtn) flipBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Switching...';

      currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
      try {
        await html5QrCode.stop();
        await html5QrCode.start(
          { facingMode: currentFacingMode },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          onScanSuccess,
          onScanFailure
        );
        showAlert("success", `Switched to ${currentFacingMode === "environment" ? "Rear" : "Front"} Camera`);
      } catch (err) {
        console.warn("Flip camera error, reverting:", err);
        currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
        showAlert("error", "Could not switch camera: " + (err.message || "Not supported"));
      } finally {
        if (flipBtn) flipBtn.innerHTML = '<i class="fa-solid fa-camera-rotate"></i> Flip Camera';
      }
    }

    // ── filterMobileScans(query) ─────────────────────────────────────────
    // Fast in-memory search for cadets in the mobile card list
    function filterMobileScans(query) {
      const q = (query || "").toLowerCase().trim();
      const mobList = document.getElementById("scan-feed-mobile-list");
      if (!mobList) return;
      const cards = mobList.querySelectorAll(".scan-card-item");
      cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? "flex" : "none";
      });
    }

    // ── handleQrFileScan(event) ─────────────────────────────────────────
    // Allows scanning by uploading an image containing a QR code
    async function handleQrFileScan(e) {
      const file = e.target.files?.[0];
      if (!file) return;

      const sessionId = document.getElementById("session-select").value;
      if (!sessionId) {
        alert("Please select an attendance session before scanning.");
        e.target.value = "";
        return;
      }

      try {
        const scanner = html5QrCode || new Html5Qrcode("qr-reader");
        const decodedText = await scanner.scanFile(file, true);
        await onScanSuccess(decodedText);
      } catch (err) {
        console.error("File scan failed:", err);
        showAlert("error", "No valid ROTC QR code found in the uploaded image.");
      } finally {
        e.target.value = "";
      }
    }

    // ── handleManualTokenScan() ──────────────────────────────────────────
    // Allows testing the scan processing logic by typing or pasting a token/student ID
    async function handleManualTokenScan() {
      const input = document.getElementById("manual-token-input");
      const token = input?.value.trim();
      if (!token) {
        alert("Please enter a student ID or token to test.");
        return;
      }

      const sessionId = document.getElementById("session-select").value;
      if (!sessionId) {
        alert("Please select an attendance session first.");
        return;
      }

      await onScanSuccess(token);
      input.value = "";
    }

    // isProcessing — mutex flag that prevents concurrent scans.
    // Without this, rapid-fire scan frames could insert duplicate records.
    let isProcessing = false;

    // ── onScanSuccess(decodedText) ────────────────────────────────────────
    // Called by html5-qrcode whenever a QR frame is decoded.
    // Flow: decode token → lookup cadet via qr_codes or profiles → resolve cadets.id
    //       → check duplicate → upsert attendance_record → update UI
    //
    // KEY SCHEMA NOTE:
    //   attendance_records.cadet_id → references cadets.id  (NOT profiles.id)
    //   qr_codes.cadet_id           → references cadets.id  (NOT profiles.id)
    //   profiles.id and cadets.profile_id link them together.
    async function onScanSuccess(decodedText) {
      // Bail if we are already processing a previous scan frame
      if (isProcessing) return;
      isProcessing = true;

      const sessionId = document.getElementById("session-select").value;

      try {
        // ── STEP 1: Identify which cadet owns this QR token ──────────────
        // We need BOTH the cadets.id (for the FK in attendance_records)
        // AND profile info (name, student_id) for the live feed display.
        let cadetRowId = null;   // cadets.id  ← what attendance_records.cadet_id needs
        let cadetProfile = null; // profiles row ← for display

        const rawText = decodedText.trim();

        // ── PRIMARY: Parse the SE-ROTC-<studentId>-<profileHexPrefix> format ──
        // QR token format from cadet-dashboard.html:
        //   SE-ROTC-{student_id}-{profile.id.substring(0,8).toUpperCase()}
        // Example: SE-ROTC-24-000001-4E63C9CF
        //   → student_id = "24-000001"
        //   → hex suffix = "4E63C9CF" (first 8 chars of profiles.id)
        let studentIdCandidate = null;

        if (rawText.startsWith("SE-ROTC-")) {
          const withoutPrefix = rawText.replace(/^SE-ROTC-/, "");
          // The last segment (8 chars hex) is the UUID prefix; everything before = student_id
          const parts = withoutPrefix.split("-");
          if (parts.length >= 2) {
            // Last part is the hex suffix, join rest as student_id
            studentIdCandidate = parts.slice(0, -1).join("-");
          } else {
            studentIdCandidate = withoutPrefix;
          }
        } else {
          // Not SE-ROTC format — treat raw text as a student_id directly
          studentIdCandidate = rawText;
        }

        // Look up profile by student_id
        if (studentIdCandidate) {
          const { data: profileRow } = await window.supabaseClient
            .from("profiles")
            .select("id, first_name, last_name, student_id, company, platoon, section, course")
            .eq("student_id", studentIdCandidate)
            .maybeSingle();

          if (profileRow) {
            cadetProfile = profileRow;
            // Now resolve cadets.id via cadets.profile_id (profiles.id → cadets.profile_id)
            const { data: cadetRow } = await window.supabaseClient
              .from("cadets")
              .select("id")
              .eq("profile_id", profileRow.id)
              .maybeSingle();
            cadetRowId = cadetRow?.id || null;
          }
        }

        // ── SECONDARY: Try qr_codes table (token column) ─────────────────
        // qr_codes.cadet_id → cadets.id
        if (!cadetRowId) {
          const { data: qrRow } = await window.supabaseClient
            .from("qr_codes")
            .select("cadet_id, cadets(id, profile_id, profiles(id, first_name, last_name, student_id, company, platoon))")
            .or(`token.eq.${rawText}`)
            .maybeSingle();

          if (qrRow?.cadet_id) {
            cadetRowId = qrRow.cadet_id;
            if (qrRow.cadets?.profiles) cadetProfile = qrRow.cadets.profiles;
          }
        }

        // ── TERTIARY: raw student_id match (no prefix) ───────────────────
        if (!cadetRowId) {
          const { data: profileRow } = await window.supabaseClient
            .from("profiles")
            .select("id, first_name, last_name, student_id, company, platoon, section, course")
            .eq("student_id", rawText)
            .maybeSingle();

          if (profileRow) {
            cadetProfile = profileRow;
            const { data: cadetRow } = await window.supabaseClient
              .from("cadets")
              .select("id")
              .eq("profile_id", profileRow.id)
              .maybeSingle();
            cadetRowId = cadetRow?.id || null;
          }
        }

        // If still no match, throw a friendly error
        if (!cadetProfile) {
          throw new Error(`No cadet found for token: "${rawText}". Make sure the cadet is registered.`);
        }

        if (!cadetRowId) {
          // ── AUTO-ENROLL: create cadets record on-the-fly so scan can proceed ──
          // This handles cadets who registered before the cadets table entry was
          // created automatically, or whose entry was missing for any reason.
          try {
            const { data: newCadet, error: createErr } = await window.supabaseClient
              .from("cadets")
              .insert({
                profile_id: cadetProfile.id,
                rotc_unit:  cadetProfile.company || 'Alpha Company',
                rank:       'Cadet'
              })
              .select("id")
              .single();

            if (!createErr && newCadet?.id) {
              cadetRowId = newCadet.id; // proceed with the newly created record
            } else {
              throw new Error(createErr?.message || 'Insert failed');
            }
          } catch (autoErr) {
            throw new Error(`Cadet "${cadetProfile.first_name} ${cadetProfile.last_name}" has no ROTC enrollment and could not be auto-enrolled: ${autoErr.message}`);
          }
        }

        // ── STEP 2: Duplicate scan check (in-memory Set) ─────────────────
        if (scannedCadetIds.has(cadetRowId)) {
          playBeep('warning');
          // Show prominent amber alert banner
          showAlert("warning", `⚠️ DUPLICATE: ${cadetProfile.first_name} ${cadetProfile.last_name} was already scanned this session!`);
          // Also fire mobile toast so it's impossible to miss on phone
          if (window.showMobileToast) {
            window.showMobileToast(`⚠️ ${cadetProfile.first_name} ${cadetProfile.last_name} already scanned!`, "error");
          }
          // Vibrate for tactile duplicate feedback
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          setTimeout(() => { isProcessing = false; }, 2000);
          return;
        }

        // Capture the current time for the record
        const now = new Date();
        const timeString = now.toTimeString().split(' ')[0]; // "HH:MM:SS"
        const dateString = now.toISOString().split('T')[0];  // "YYYY-MM-DD"

        // ── STEP 3: Upsert into attendance_records ────────────────────────
        // cadet_id here is cadets.id (NOT profiles.id) — matches the FK constraint
        let { error: insertErr } = await window.supabaseClient
          .from("attendance_records")
          .upsert({
            session_id: sessionId,       // FK → attendance_sessions.id
            cadet_id:   cadetRowId,      // FK → cadets.id  ← CRITICAL: must be cadets.id
            status:     "present",       // QR scan always = present
            scanned_at: now.toISOString(),
            recorded_by: currentOfficer?.id || null, // FK → profiles.id
          }, { onConflict: "session_id,cadet_id" });

        if (insertErr) throw insertErr;

        // ── STEP 4: Update UI on success ─────────────────────────────────
        scannedCadetIds.add(cadetRowId); // track by cadets.id to prevent duplicates
        scannedCount++;
        document.getElementById("scan-counter").textContent = `${scannedCount} Cadets Marked`;

        // 🔊 Play success beep
        playBeep('success');

        // 🎉 Show full-name success popup for 3 seconds
        showSuccessPopup(cadetProfile, timeString);

        // Green success banner with cadet details and recorded time
        showAlert("success", `✅ PRESENT: ${cadetProfile.first_name} ${cadetProfile.last_name} (${cadetProfile.student_id}) recorded at ${timeString}`);

        // Prepend a new row to the live feed table
        addFeedRow(timeString, `${cadetProfile.first_name} ${cadetProfile.last_name}`, cadetProfile.student_id, cadetProfile.company || 'Unassigned');

        // Vibrate the device (if supported) as tactile confirmation
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

      } catch (err) {
        console.error(err);
        playBeep('error');
        showAlert("error", err.message || "Failed to record scan.");
      } finally {
        // Release the mutex after 2 seconds to allow the next scan
        setTimeout(() => { isProcessing = false; }, 2000);
      }
    }

    // ── onScanFailure() ──────────────────────────────────────────────────
    // Called for every camera frame that does NOT contain a valid QR code.
    // We intentionally leave this empty — logging every miss would flood
    // the console at 10 fps.
    function onScanFailure(error) {
      // Quiet background frames
    }

    // ── showAlert(type, text) ─────────────────────────────────────────────
    // Displays a coloured alert banner above the camera viewfinder.
    // type: 'success' | 'warning' | 'error'
    let _alertTimer = null;
    function showAlert(type, text) {
      const alertBox = document.getElementById("scan-alert");
      alertBox.className = `alert alert-${type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'error'}`;
      alertBox.textContent = text;
      alertBox.style.display = "flex";
      // Auto-hide after 5 seconds
      if (_alertTimer) clearTimeout(_alertTimer);
      _alertTimer = setTimeout(() => {
        alertBox.style.display = "none";
      }, 5000);
    }

    // ── getInitials(name) ────────────────────────────────────────────────
    function getInitials(name) {
      if (!name) return 'CD';
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    // ── toggleAltInputs() ────────────────────────────────────────────────
    function toggleAltInputs() {
      const body = document.getElementById("alt-inputs-body");
      const chev = document.getElementById("alt-inputs-chevron");
      if (!body) return;
      const isOpen = body.classList.toggle("open");
      if (chev) {
        chev.className = isOpen ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
      }
    }

    // ── addFeedRow(time, name, id, unit) ─────────────────────────────────
    // Prepends a new item to BOTH #scan-feed-tbody (desktop) AND
    // #scan-feed-mobile-list (mobile cards) so the most recent scan appears
    // immediately at the top on all device screen sizes.
    function addFeedRow(time, name, id, unit) {
      // 1. Update Desktop Table
      const tbody = document.getElementById("scan-feed-tbody");
      if (tbody) {
        if (tbody.rows.length === 1 && tbody.rows[0].cells.length === 1) {
          tbody.innerHTML = "";
        }
        const tr = document.createElement("tr");
        tr.style.animation = "fadeInRow 0.3s ease";
        tr.innerHTML = `
          <td style="font-family: monospace;">${time}</td>
          <td><strong>${name}</strong></td>
          <td style="font-family: monospace;">${id}</td>
          <td><span class="badge badge-admin">${unit}</span></td>
          <td><span class="badge badge-approved">PRESENT</span></td>
        `;
        tbody.prepend(tr);
      }

      // 2. Update Mobile Cards Stream
      const mobList = document.getElementById("scan-feed-mobile-list");
      if (mobList) {
        // If placeholder text is showing, clear it first
        if (mobList.children.length === 1 && !mobList.children[0].classList.contains("scan-card-item")) {
          mobList.innerHTML = "";
        }
        const card = document.createElement("div");
        card.className = "scan-card-item";
        card.innerHTML = `
          <div class="avatar-sm">${getInitials(name)}</div>
          <div class="card-info">
            <div class="card-name">${name}</div>
            <div class="card-meta">
              <span style="font-family: monospace; font-weight:600;">${id}</span>
              <span>&bull;</span>
              <span>${unit}</span>
            </div>
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            <div class="card-time">${time}</div>
            <span class="scan-card-present"><i class="fa-solid fa-check"></i> PRESENT</span>
          </div>
        `;
        mobList.prepend(card);
      }
    }
  