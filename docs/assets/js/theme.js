(function () {
  var root = document.documentElement;
  var stored = localStorage.getItem("orbitps2-docs-theme");

  function apply(theme) {
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  apply(stored);

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.getElementById("theme-toggle");
    var sidebarToggle = document.getElementById("sidebar-toggle");
    var sidebar = document.getElementById("sidebar");

    function currentlyDark() {
      var explicit = localStorage.getItem("orbitps2-docs-theme");
      if (explicit) return explicit === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function updateLabel() {
      if (!toggle) return;
      toggle.textContent = currentlyDark() ? "☀️ Light mode" : "🌙 Dark mode";
    }
    updateLabel();

    if (toggle) {
      toggle.addEventListener("click", function () {
        var next = currentlyDark() ? "light" : "dark";
        localStorage.setItem("orbitps2-docs-theme", next);
        apply(next);
        updateLabel();
      });
    }

    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener("click", function () {
        sidebar.classList.toggle("open");
      });
      document.addEventListener("click", function (e) {
        if (
          sidebar.classList.contains("open") &&
          !sidebar.contains(e.target) &&
          !sidebarToggle.contains(e.target)
        ) {
          sidebar.classList.remove("open");
        }
      });
    }
  });
})();
