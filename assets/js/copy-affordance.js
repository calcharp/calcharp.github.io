(function () {
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        if (!document.execCommand("copy")) {
          reject(new Error("copy failed"));
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  document.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-copy]");
    if (!btn) {
      return;
    }
    event.preventDefault();
    var text = btn.getAttribute("data-copy");
    if (!text) {
      return;
    }
    copyText(text).then(function () {
      btn.classList.add("is-copied");
      var prev = btn.getAttribute("aria-label") || "";
      btn.setAttribute("aria-label", "Copied");
      window.setTimeout(function () {
        btn.classList.remove("is-copied");
        if (prev) {
          btn.setAttribute("aria-label", prev);
        }
      }, 1200);
    });
  });
})();
