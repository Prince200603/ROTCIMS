// ==========================================================================
// FILE: js/user-menu.js
// PURPOSE: Interactive Dropdown Menu for Commandant / Admin / Staff User Badge
// ==========================================================================
(function() {
  function initUserBadgeMenu() {
    const userBadgeEl = document.querySelector('.user-badge');
    if (!userBadgeEl || userBadgeEl.dataset.dropdownAttached === 'true') return;

    userBadgeEl.dataset.dropdownAttached = 'true';
    userBadgeEl.style.cursor = 'pointer';
    userBadgeEl.title = 'Click to open account menu';
    userBadgeEl.setAttribute('tabindex', '0');
    userBadgeEl.setAttribute('role', 'button');
    userBadgeEl.setAttribute('aria-haspopup', 'true');
    userBadgeEl.setAttribute('aria-expanded', 'false');

    if (getComputedStyle(userBadgeEl).position === 'static') {
      userBadgeEl.style.position = 'relative';
    }

    // Inject Styles once
    if (!document.getElementById('user-menu-styles')) {
      const style = document.createElement('style');
      style.id = 'user-menu-styles';
      style.textContent = [
        '@keyframes userMenuPop {',
        '  from { opacity: 0; transform: translateY(-8px) scale(0.96); }',
        '  to   { opacity: 1; transform: translateY(0) scale(1); }',
        '}',
        '.user-badge {',
        '  display: flex !important;',
        '  align-items: center !important;',
        '  gap: 0.65rem !important;',
        '  padding: 0.35rem 0.65rem !important;',
        '  border-radius: 12px !important;',
        '  border: 1px solid transparent !important;',
        '  transition: all 0.2s ease !important;',
        '}',
        '.user-badge:hover {',
        '  background: rgba(201, 152, 58, 0.08) !important;',
        '  border-color: rgba(201, 152, 58, 0.3) !important;',
        '  box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;',
        '}',
        '.user-badge-chevron {',
        '  font-size: 0.72rem !important;',
        '  color: #dfb54e !important;',
        '  margin-left: 0.25rem !important;',
        '  transition: transform 0.25s ease, color 0.2s ease !important;',
        '  opacity: 0.8 !important;',
        '}',
        '.user-badge:hover .user-badge-chevron {',
        '  opacity: 1 !important;',
        '  color: #ffffff !important;',
        '}',
        '.user-badge.menu-open {',
        '  background: rgba(201, 152, 58, 0.12) !important;',
        '  border-color: rgba(201, 152, 58, 0.45) !important;',
        '}',
        '.user-badge.menu-open .user-badge-chevron {',
        '  transform: rotate(180deg) !important;',
        '  color: #dfb54e !important;',
        '}',
        '.user-dropdown-menu {',
        '  position: absolute !important;',
        '  top: calc(100% + 10px) !important;',
        '  right: 0 !important;',
        '  width: 260px !important;',
        '  background: #0d1f15 !important;',
        '  border: 1px solid rgba(201, 152, 58, 0.35) !important;',
        '  border-radius: 12px !important;',
        '  box-shadow: 0 16px 36px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06) !important;',
        '  padding: 0.75rem 0.5rem !important;',
        '  display: none;',
        '  flex-direction: column !important;',
        '  gap: 0.25rem !important;',
        '  z-index: 99999 !important;',
        '  backdrop-filter: blur(16px) !important;',
        '  animation: userMenuPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);',
        '}',
        '.user-dropdown-item {',
        '  display: flex !important; align-items: center !important; gap: 0.75rem !important;',
        '  padding: 0.6rem 0.85rem !important; border-radius: 8px !important;',
        '  color: #d1ded5 !important; text-decoration: none !important;',
        '  font-size: 0.82rem !important; font-weight: 500 !important;',
        '  transition: all 0.18s ease !important; cursor: pointer !important;',
        '  border: none !important; background: transparent !important; width: 100% !important; text-align: left !important;',
        '  box-sizing: border-box !important;',
        '}',
        '.user-dropdown-item:hover {',
        '  background: rgba(201, 152, 58, 0.12) !important;',
        '  color: #dfb54e !important; transform: translateX(3px) !important;',
        '}',
        '.user-dropdown-item.danger { color: #fca5a5 !important; }',
        '.user-dropdown-item.danger:hover {',
        '  background: rgba(239, 68, 68, 0.15) !important;',
        '  color: #ffffff !important;',
        '}',
        '.user-dropdown-item i {',
        '  width: 18px !important; text-align: center !important; font-size: 0.85rem !important;',
        '  color: #c9983a !important;',
        '}',
        '.user-dropdown-item.danger i { color: #ef4444 !important; }',
        '.user-dropdown-divider {',
        '  height: 1px !important; background: rgba(201, 152, 58, 0.15) !important;',
        '  margin: 0.35rem 0.5rem !important;',
        '}',
        '.user-dropdown-header {',
        '  padding: 0.4rem 0.85rem 0.65rem !important;',
        '  border-bottom: 1px solid rgba(201, 152, 58, 0.15) !important;',
        '  margin-bottom: 0.3rem !important;',
        '}'
      ].join('\n');
      document.head.appendChild(style);
    }

    // Add down-arrow (chevron-down) mark to userBadge
    if (!userBadgeEl.querySelector('.user-badge-chevron')) {
      const chevron = document.createElement('i');
      chevron.className = 'fa-solid fa-chevron-down user-badge-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      userBadgeEl.appendChild(chevron);
    }

    const menu = document.createElement('div');
    menu.className = 'user-dropdown-menu';
    menu.id = 'user-dropdown-menu';

    function renderMenuContent() {
      const name = document.getElementById('user-name')?.textContent || 'Commandant Administrator';
      const role = document.getElementById('user-role')?.textContent || 'ADMINISTRATOR';

      menu.innerHTML = [
        '<div class="user-dropdown-header">',
        '  <div style="font-weight:700; font-size:0.86rem; color:#fff;">' + name + '</div>',
        '  <div style="font-size:0.72rem; color:#dfb54e; font-weight:600; text-transform:uppercase; margin-top:2px;">' + role + '</div>',
        '  <div style="font-size:0.7rem; color:#839788; margin-top:2px;"><i class="fa-solid fa-circle-check" style="color:#22c55e; font-size:0.65rem;"></i> Active Command Session</div>',
        '</div>',
        '<a href="admin-settings.html" class="user-dropdown-item">',
        '  <i class="fa-solid fa-user-gear"></i>',
        '  <span>Admin Account & Profile</span>',
        '</a>',
        '<a href="admin-settings.html#storage" class="user-dropdown-item" onclick="localStorage.setItem(\'settings_active_tab\', \'storage\')">',
        '  <i class="fa-solid fa-database"></i>',
        '  <span>Supabase Storage</span>',
        '</a>',
        '<div class="user-dropdown-divider"></div>',
        '<button type="button" class="user-dropdown-item" onclick="window.togglePortalTheme && window.togglePortalTheme()">',
        '  <i class="fa-solid fa-circle-half-stroke"></i>',
        '  <span>Toggle Dark / Light Theme</span>',
        '</button>',
        '<div class="user-dropdown-divider"></div>',
        '<button type="button" class="user-dropdown-item danger" onclick="window.Auth && Auth.logout ? Auth.logout() : (window.location.href=\'login.html\')">',
        '  <i class="fa-solid fa-arrow-right-from-bracket"></i>',
        '  <span>Sign Out / Log Out</span>',
        '</button>'
      ].join('');
    }

    renderMenuContent();
    userBadgeEl.appendChild(menu);

    // Toggle dropdown
    userBadgeEl.addEventListener('click', (e) => {
      if (e.target.closest('.user-dropdown-item')) return;
      renderMenuContent(); // Refresh name/role in case profile just loaded
      const isShown = menu.style.display === 'flex';
      menu.style.display = isShown ? 'none' : 'flex';
      userBadgeEl.classList.toggle('menu-open', !isShown);
      userBadgeEl.setAttribute('aria-expanded', !isShown);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!userBadgeEl.contains(e.target)) {
        menu.style.display = 'none';
        userBadgeEl.classList.remove('menu-open');
        userBadgeEl.setAttribute('aria-expanded', 'false');
      }
    });

    // Keyboard support (Escape closes, Enter opens)
    userBadgeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const isShown = menu.style.display === 'flex';
        menu.style.display = isShown ? 'none' : 'flex';
        userBadgeEl.classList.toggle('menu-open', !isShown);
      } else if (e.key === 'Escape') {
        menu.style.display = 'none';
        userBadgeEl.classList.remove('menu-open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUserBadgeMenu);
  } else {
    initUserBadgeMenu();
  }

  // Re-run after auth updateUI has populated profile
  window.addEventListener('load', () => {
    setTimeout(initUserBadgeMenu, 350);
  });
})();
