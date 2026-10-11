(function () {
  function flattenRoot(root) {
    if (!root || root.getAttribute("data-other-flat") === "1") {
      return;
    }
    var items = root.querySelectorAll(".navbar__menu > .has-submenu");
    if (!items.length) {
      return;
    }
    Array.prototype.forEach.call(items, function (item) {
      var sub = item.querySelector(".navbar__submenu");
      var menu = item.parentNode;
      if (!sub || !menu) {
        return;
      }
      while (sub.firstElementChild) {
        menu.insertBefore(sub.firstElementChild, item);
      }
      item.parentNode.removeChild(item);
    });
    root.setAttribute("data-other-flat", "1");
  }

  function flattenAll() {
    flattenRoot(document.querySelector(".navbar_mobile_sidebar"));
    flattenRoot(document.querySelector(".navbar_mobile_overlay"));
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    flattenAll();
    var btn = document.querySelector(".navbar__toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        window.setTimeout(flattenAll, 0);
      });
    }
    window.addEventListener("resize", flattenAll);
  });
})();
