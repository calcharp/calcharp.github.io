(function () {
  var shell = document.querySelector(".home-panel-shell");
  var panel = document.querySelector(".home-panel");
  if (!shell || !panel) {
    return;
  }

  var button = panel.querySelector(".home-panel__expand");
  var backdrop = shell.querySelector(".home-panel-backdrop");
  var path = button ? button.querySelector(".home-panel__expand-path") : null;
  if (!button || !backdrop || !path) {
    return;
  }

  var PATH_GROW = "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4";
  var PATH_SHRINK = "M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4";

  function setExpanded(expanded) {
    if (expanded) {
      shell.style.minHeight = panel.offsetHeight + "px";
    } else {
      shell.style.minHeight = "";
    }

    panel.classList.toggle("is-expanded", expanded);
    document.body.classList.toggle("home-panel-open", expanded);
    backdrop.hidden = !expanded;
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute("aria-label", expanded ? "Close enlarged panel" : "Expand panel");
    path.setAttribute("d", expanded ? PATH_SHRINK : PATH_GROW);

    if (expanded) {
      button.focus();
    }
  }

  button.addEventListener("click", function () {
    setExpanded(!panel.classList.contains("is-expanded"));
  });

  backdrop.addEventListener("click", function () {
    setExpanded(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.classList.contains("is-expanded")) {
      setExpanded(false);
    }
  });
})();
