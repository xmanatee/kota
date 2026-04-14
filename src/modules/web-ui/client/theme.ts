/** Theme toggle logic for the KOTA web UI. */

export const CLIENT_THEME_JS = `
  function applyTheme(theme) {
    if (theme === "light") {
      document.body.classList.add("light");
    } else {
      document.body.classList.remove("light");
    }
  }

  function toggleTheme() {
    var current = document.body.classList.contains("light") ? "light" : "dark";
    var next = current === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem("kota.theme", next);
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = next === "light" ? "☀" : "☾";
  }

  (function initTheme() {
    var stored = localStorage.getItem("kota.theme") || "dark";
    applyTheme(stored);
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = stored === "light" ? "☀" : "☾";
    btn && btn.addEventListener("click", toggleTheme);
  })();
`;
