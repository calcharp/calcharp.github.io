(function () {
  var README_URLS = [
    "https://cdn.jsdelivr.net/gh/calcharp/Evolution-Deep-Learning-Reading-Group@main/README.md",
    "https://raw.githubusercontent.com/calcharp/Evolution-Deep-Learning-Reading-Group/main/README.md"
  ];
  var REPO_URL = "https://github.com/calcharp/Evolution-Deep-Learning-Reading-Group";
  var contentEl = document.getElementById("reading-group-content");

  if (!contentEl) {
    return;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, "&#39;");
  }

  function stripTags(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  }

  function normalizeSectionTitle(title) {
    return title
      .replace(/^[^\w]+/, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "")
      .trim();
  }

  function parseSections(markdown) {
    var sections = {};
    var parts = markdown.split(/^## /m);

    parts.slice(1).forEach(function (part) {
      var newline = part.indexOf("\n");
      var title = normalizeSectionTitle(part.slice(0, newline));
      sections[title] = part.slice(newline + 1).trim();
    });

    return sections;
  }

  function parseAnchorFromLine(line) {
    var match = line.match(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!match) {
      return null;
    }

    return {
      href: match[1],
      label: stripTags(match[2])
    };
  }

  function parseTableRow(line) {
    return line
      .split("|")
      .slice(1, -1)
      .map(function (cell) {
        return cell.trim();
      });
  }

  function parseMarkdownTable(text) {
    var lines = text
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.indexOf("|") === 0;
      });

    if (lines.length < 2) {
      return { headers: [], rows: [] };
    }

    return {
      headers: parseTableRow(lines[0]),
      rows: lines.slice(2).map(parseTableRow)
    };
  }

  function sanitizeTableCell(cell) {
    var anchor = parseAnchorFromLine(cell);
    if (anchor) {
      if (!anchor.href) {
        return escapeHtml(anchor.label);
      }

      return (
        '<a href="' +
        escapeAttr(anchor.href) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(anchor.label) +
        "</a>"
      );
    }

    if (cell === "—" || cell === "-" || cell === "&mdash;") {
      return '<span class="reading-group__empty">—</span>';
    }

    return escapeHtml(cell);
  }

  function renderTable(table) {
    if (!table.headers.length) {
      return "";
    }

    var headerHtml = table.headers
      .map(function (header) {
        return "<th scope=\"col\">" + escapeHtml(header) + "</th>";
      })
      .join("");

    var bodyHtml = table.rows
      .map(function (row) {
        var cells = row
          .map(function (cell) {
            return "<td>" + sanitizeTableCell(cell) + "</td>";
          })
          .join("");
        return "<tr>" + cells + "</tr>";
      })
      .join("");

    return (
      '<div class="reading-group-table-wrap">' +
      '<table class="reading-group-table">' +
      "<thead><tr>" +
      headerHtml +
      "</tr></thead>" +
      "<tbody>" +
      bodyHtml +
      "</tbody></table></div>"
    );
  }

  function parseDetailsBlocks(body) {
    var blocks = [];
    var pattern = /<details[^>]*>([\s\S]*?)<\/details>/gi;
    var match;

    while ((match = pattern.exec(body))) {
      var inner = match[1];
      var summaryMatch = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      var title = summaryMatch ? stripTags(summaryMatch[1]) : "Meetings";
      var tableText = inner.replace(/<summary[\s\S]*?<\/summary>/i, "").trim();

      blocks.push({
        title: title,
        table: parseMarkdownTable(tableText)
      });
    }

    return blocks;
  }

  function renderMeetings(body) {
    var blocks = parseDetailsBlocks(body);
    if (!blocks.length) {
      return "";
    }

    return blocks
      .map(function (block) {
        return (
          '<details class="reading-group-year">' +
          "<summary><strong class=\"reading-group-year__title\">" +
          escapeHtml(block.title) +
          "</strong></summary>" +
          renderTable(block.table) +
          "</details>"
        );
      })
      .join("");
  }

  function renderContent(markdown) {
    var sections = parseSections(markdown);
    var meetings = sections["Past Meetings"] || "";
    var html = renderMeetings(meetings);

    contentEl.innerHTML = html || "<p>No meetings listed yet.</p>";
  }

  function renderError() {
    contentEl.innerHTML =
      '<div class="reading-group-error">' +
      "<p>Could not load past meetings right now.</p>" +
      '<p><a href="' +
      REPO_URL +
      '" target="_blank" rel="noopener">View on GitHub →</a></p>' +
      "</div>";
  }

  function fetchReadme(index) {
    if (index >= README_URLS.length) {
      return Promise.reject(new Error("All README sources failed"));
    }

    return fetch(README_URLS[index]).then(function (response) {
      if (!response.ok) {
        throw new Error("README request failed");
      }

      return response.text();
    }).catch(function () {
      return fetchReadme(index + 1);
    });
  }

  fetchReadme(0)
    .then(function (markdown) {
      renderContent(markdown);
    })
    .catch(function () {
      renderError();
    });
})();
