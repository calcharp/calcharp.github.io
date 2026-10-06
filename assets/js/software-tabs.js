(function () {
  var root = document.querySelector("[data-panel-tabs]");
  if (!root) {
    return;
  }

  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('[role="tabpanel"]'));
  var prevBtn = null;
  var nextBtn = null;

  function panelIdFromTab(tab) {
    return tab.getAttribute("aria-controls");
  }

  function selectedIndex() {
    var i;
    for (i = 0; i < tabs.length; i += 1) {
      if (tabs[i].getAttribute("aria-selected") === "true") {
        return i;
      }
    }
    return 0;
  }

  function activate(id, updateHash) {
    var matched = false;

    tabs.forEach(function (tab) {
      var selected = panelIdFromTab(tab) === id;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      if (selected) {
        matched = true;
        if (typeof tab.scrollIntoView === "function") {
          tab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
        }
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

  function step(delta) {
    if (!tabs.length) {
      return;
    }
    var index = selectedIndex();
    var next = (index + delta + tabs.length) % tabs.length;
    activate(panelIdFromTab(tabs[next]), true);
  }

  function idFromHash() {
    var hash = (location.hash || "").replace(/^#/, "");
    return hash || null;
  }

  function chevronSvg(dir) {
    var points =
      dir === "prev" ? "15.5 4.5 8.5 12 15.5 19.5" : "8.5 4.5 15.5 12 8.5 19.5";
    return (
      '<svg class="software-tabs__chevron" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="' +
      points +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>"
    );
  }

  function mountArrows() {
    if (tabs.length < 2) {
      return;
    }

    var list = root.querySelector(".software-tabs__list");
    if (!list) {
      return;
    }

    var stage = document.createElement("div");
    stage.className = "software-tabs__stage";

    prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "software-tabs__arrow software-tabs__arrow--prev";
    prevBtn.setAttribute("aria-label", "Previous item");
    prevBtn.innerHTML = chevronSvg("prev");

    nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "software-tabs__arrow software-tabs__arrow--next";
    nextBtn.setAttribute("aria-label", "Next item");
    nextBtn.innerHTML = chevronSvg("next");

    var panelsWrap = document.createElement("div");
    panelsWrap.className = "software-tabs__panels";
    panels.forEach(function (panel) {
      panelsWrap.appendChild(panel);
    });

    stage.appendChild(prevBtn);
    stage.appendChild(panelsWrap);
    stage.appendChild(nextBtn);
    list.insertAdjacentElement("afterend", stage);

    prevBtn.addEventListener("click", function () {
      step(-1);
    });
    nextBtn.addEventListener("click", function () {
      step(1);
    });
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

  mountArrows();
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

  function openLightbox(src, alt, onWhite) {
    if (!lightbox || !lightboxImage) {
      return;
    }
    lightboxImage.src = src;
    lightboxImage.alt = alt || "";
    lightboxImage.classList.toggle("software-lightbox__image--on-white", !!onWhite);
    lightbox.hidden = false;
    document.body.classList.add("software-lightbox-open");
    var backdrop = lightbox.querySelector(".software-lightbox__backdrop");
    if (backdrop) {
      backdrop.focus();
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
    openLightbox(
      img.currentSrc || img.src,
      img.alt,
      img.classList.contains("software-panel__media--on-white")
    );
  });

  if (lightbox) {
    var backdrop = lightbox.querySelector(".software-lightbox__backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", closeLightbox);
    }
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && lightbox && !lightbox.hidden) {
      closeLightbox();
    }
  });
})();
