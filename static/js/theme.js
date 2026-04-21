/* ===== MODULE: THEME TOGGLE
   Loaded from: /static/js/theme.js
   Persists user preference to localStorage('theme').
   The FOUC-prevention inline script in <head> applies the saved theme
   before CSS loads — this module only handles UI updates and the toggle.
   ===== */

function themeToggle() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  _syncThemeBtn();
}

function _syncThemeBtn() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const icon = btn.querySelector('.theme-icon');
  const label = btn.querySelector('.theme-label');
  if (icon) icon.textContent = isDark ? '\u2600' : '\u263e';
  if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

document.addEventListener('DOMContentLoaded', _syncThemeBtn);
