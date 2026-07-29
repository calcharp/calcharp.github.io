(function () {
  var root = document.querySelector("[data-panel-tabs]");
  if (!root) {
    return;
  }

  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('[role="tabpanel"]'));

  function panelIdFromTab(tab) {
    return tab.getAttribute("aria-controls");
  }

  function activate(id, updateHash) {
    var matched = false;

    tabs.forEach(function (tab) {
      var selected = panelIdFromTab(tab) === id;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      if (selected) {
        matched = true;
      }
    });

    panels.forEach(function (panel) {
      var selected = panel.id === id;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    });

    if (!matched && tabs.length) {
      activate(panelIdFromTab(tabs[0]), updateHash);
      return;
    }

    if (updateHash && id) {
      if (history.replaceState) {
        history.replaceState(null, "", "#" + id);
      } else {
        location.hash = id;
      }
    }
  }

  function idFromHash() {
    var hash = (location.hash || "").replace(/^#/, "");
    return hash || null;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      activate(panelIdFromTab(tab), true);
    });

    tab.addEventListener("keydown", function (event) {
      var index = tabs.indexOf(tab);
      var next = index;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = tabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      tabs[next].focus();
      activate(panelIdFromTab(tabs[next]), true);
    });
  });

  window.addEventListener("hashchange", function () {
    var id = idFromHash();
    if (id) {
      activate(id, false);
    }
  });

  activate(idFromHash() || panelIdFromTab(tabs[0]), false);

  var lightbox = document.getElementById("software-lightbox");
  var lightboxImage = lightbox ? lightbox.querySelector(".software-lightbox__image") : null;

  function closeLightbox() {
    if (!lightbox) {
      return;
    }
    lightbox.hidden = true;
    document.body.classList.remove("software-lightbox-open");
  }

  function openLightbox(src, alt) {
    if (!lightbox || !lightboxImage) {
      return;
    }
    lightboxImage.src = src;
    lightboxImage.alt = alt || "";
    lightbox.hidden = false;
    document.body.classList.add("software-lightbox-open");
    var closeBtn = lightbox.querySelector(".software-lightbox__close");
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  root.addEventListener("click", function (event) {
    var trigger = event.target.closest(".software-panel__zoom");
    if (!trigger || !root.contains(trigger)) {
      return;
    }
    var img = trigger.querySelector("img");
    if (!img) {
      return;
    }
    openLightbox(img.currentSrc || img.src, img.alt);
  });

  if (lightbox) {
    lightbox.querySelectorAll(".software-lightbox__backdrop, .software-lightbox__close").forEach(function (el) {
      el.addEventListener("click", closeLightbox);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && lightbox && !lightbox.hidden) {
      closeLightbox();
    }
  });
})();
