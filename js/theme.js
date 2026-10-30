// ==========================================================================
// FILE: js/theme.js
// PURPOSE: Handles Ultra-Clean Minimalist Glass & Modern Theme Toggle (Light / Dark)
//          Persists user preference in localStorage and respects system prefers-color-scheme.
// ==========================================================================

(function() {
  const THEME_KEY = "rotcims-theme";

  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    
    // Update any theme toggle buttons on the page
    const toggles = document.querySelectorAll(".theme-toggle-btn");
    toggles.forEach(btn => {
      const icon = btn.querySelector("i");
      const label = btn.querySelector(".theme-label");
      if (theme === "dark") {
        if (icon) icon.className = "fa-solid fa-sun";
        if (label) label.textContent = "Light Mode";
        btn.setAttribute("title", "Switch to Clean Light Mode");
        btn.setAttribute("aria-label", "Switch to Clean Light Mode");
      } else {
        if (icon) icon.className = "fa-solid fa-moon";
        if (label) label.textContent = "Dark Mode";
        btn.setAttribute("title", "Switch to Command Dark Mode");
        btn.setAttribute("aria-label", "Switch to Command Dark Mode");
      }
    });
  }

  // Apply immediately to prevent flash of wrong theme
  const initialTheme = getPreferredTheme();
  document.documentElement.setAttribute("data-theme", initialTheme);

  window.togglePortalTheme = function() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    if (window.showPortalToast) {
      window.showPortalToast(next === "dark" ? "Command Dark Mode enabled" : "Clean Light Mode enabled", "info");
    }
  };

  // Listen for DOM ready to sync button states
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(getPreferredTheme());
  });
})();

