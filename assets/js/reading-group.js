(function () {
  var themeBtn = document.querySelector("[data-rg-theme]");
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
  }
  function applyTheme(theme) {
    var next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("rg-theme", next);
    } catch (e) {
      /* ignore */
    }
    if (themeBtn) {
      themeBtn.setAttribute(
        "aria-label",
        next === "dark" ? "Switch to light mode" : "Switch to dark mode"
      );
    }
  }
  if (themeBtn) {
    applyTheme(currentTheme());
    themeBtn.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  var root = document.querySelector("[data-rg]");
  if (!root) {
    return;
  }

  var listHost = root.querySelector("[data-rg-history]");
  var eventsHost = root.querySelector("[data-rg-events]");
  var eventsSection = document.getElementById("events");
  var status = root.querySelector("[data-rg-status]");
  if (!listHost) {
    return;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    var parts = String(iso || "").split("-");
    if (parts.length !== 3) {
      return iso || "";
    }
    var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function yearOf(iso) {
    return String(iso || "").slice(0, 4);
  }

  function renderEvents(events) {
    if (!eventsHost || !eventsSection) {
      return;
    }
    if (!events.length) {
      eventsSection.hidden = true;
      return;
    }
    eventsSection.hidden = false;
    var html = '<ul class="rg-special">';
    events.forEach(function (ev) {
      html += "<li><strong>" + escapeHtml(formatDate(ev.date)) + "</strong> ";
      html += escapeHtml(ev.title || "Event");
      if (ev.url) {
        html +=
          ' · <a href="' +
          escapeHtml(ev.url) +
          '" target="_blank" rel="noopener">Details</a>';
      }
      html += "</li>";
    });
    html += "</ul>";
    eventsHost.innerHTML = html;
  }

  function renderMeetings(meetings) {
    var byYear = {};
    meetings.forEach(function (m) {
      var y = yearOf(m.date) || "Other";
      if (!byYear[y]) {
        byYear[y] = [];
      }
      byYear[y].push(m);
    });

    var years = Object.keys(byYear).sort(function (a, b) {
      return Number(b) - Number(a);
    });

    var html = '<div class="rg-years">';
    years.forEach(function (year, index) {
      html += '<details class="rg-year"' + (index === 0 ? " open" : "") + ">";
      html += "<summary>" + escapeHtml(year) + "</summary>";
      html += '<div class="rg-table-wrap"><table class="rg-table"><thead><tr>';
      html +=
        '<th scope="col">Date</th>' +
        '<th scope="col">Presenter</th>' +
        '<th scope="col">Title</th>' +
        '<th class="rg-rec" scope="col">Recording</th>';
      html += "</tr></thead><tbody>";

      byYear[year]
        .slice()
        .sort(function (a, b) {
          return String(b.date).localeCompare(String(a.date));
        })
        .forEach(function (m) {
          html += "<tr>";
          html += '<td class="rg-date">' + escapeHtml(formatDate(m.date)) + "</td>";
          html +=
            '<td class="rg-presenter">' + escapeHtml(m.presenter || "TBA") + "</td>";
          html += '<td class="rg-title">';
          if (m.url) {
            html +=
              '<a href="' +
              escapeHtml(m.url) +
              '" target="_blank" rel="noopener">' +
              escapeHtml(m.title || "Untitled") +
              "</a>";
          } else {
            html += escapeHtml(m.title || "Untitled");
          }
          html += "</td>";
          html += '<td class="rg-rec">';
          html += m.recording
            ? '<a href="' +
              escapeHtml(m.recording) +
              '" target="_blank" rel="noopener">Link</a>'
            : "—";
          html += "</td></tr>";
        });

      html += "</tbody></table></div></details>";
    });
    html += "</div>";

    listHost.innerHTML = html;
    if (status) {
      status.remove();
    }
  }

  fetch("data/reading-group.json?v=2")
    .then(function (res) {
      if (!res.ok) {
        throw new Error("Could not load schedule");
      }
      return res.json();
    })
    .then(function (data) {
      renderEvents(Array.isArray(data.events) ? data.events : []);
      var meetings = Array.isArray(data.meetings) ? data.meetings : [];
      if (!meetings.length) {
        if (status) {
          status.textContent = "No meetings listed yet.";
        }
        return;
      }
      renderMeetings(meetings);
    })
    .catch(function () {
      if (status) {
        status.textContent = "Couldn’t load the schedule.";
      }
    });
})();
