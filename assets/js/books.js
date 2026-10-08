(function () {
  var root = document.querySelector("[data-books]");
  if (!root) {
    return;
  }

  var grid = root.querySelector("[data-books-grid]");
  var status = root.querySelector("[data-books-status]");
  if (!grid) {
    return;
  }

  var booksCache = null;

  function colsForViewport() {
    if (window.matchMedia("(max-width: 42.74em)").matches) {
      return 5;
    }
    return 8;
  }

  /**
   * Pack into rows of maxCols. If the last row has 1 book, fold it into the
   * previous row (that row shrinks covers to fit one more). If it has 2, fold
   * one into each of the previous two rows. At 3+, leave rows at normal size.
   */
  function packRowSizes(n, maxCols) {
    if (n <= 0) {
      return [];
    }
    if (n <= maxCols) {
      return [n];
    }

    var sizes = [];
    var remaining = n;
    while (remaining > 0) {
      var take = Math.min(maxCols, remaining);
      sizes.push(take);
      remaining -= take;
    }

    var last = sizes[sizes.length - 1];
    if (last >= 3 || sizes.length === 1) {
      return sizes;
    }

    var orphans = sizes.pop();
    var r = sizes.length - 1;
    while (orphans > 0 && r >= 0) {
      sizes[r] += 1;
      orphans -= 1;
      r -= 1;
    }
    if (orphans > 0) {
      if (sizes.length) {
        sizes[sizes.length - 1] += orphans;
      } else {
        sizes.push(orphans);
      }
    }
    return sizes;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderCover(book) {
    var title = book.title || "Untitled";
    var author = book.author || "";
    var url = book.url || "#";
    var cover = book.cover || "";
    var label = title + (author ? " — " + author : "");
    var face = cover
      ? '<img class="book-cover__img" src="' +
        escapeHtml(cover) +
        '" alt="' +
        escapeHtml(title) +
        '" loading="lazy" width="200" height="300">'
      : '<span class="book-cover__fallback" aria-hidden="true"><span>' +
        escapeHtml(title) +
        "</span></span>";

    return (
      '<li class="book-cover">' +
      '<a class="book-cover__link" href="' +
      escapeHtml(url) +
      '" target="_blank" rel="noopener" title="' +
      escapeHtml(label) +
      '" aria-label="' +
      escapeHtml(label) +
      '">' +
      face +
      "</a>" +
      "</li>"
    );
  }

  function renderShelves(books) {
    var cols = colsForViewport();
    var sizes = packRowSizes(books.length, cols);
    var html = '<li class="books-case"><div class="books-case__inner">';
    var offset = 0;
    var s;
    for (s = 0; s < sizes.length; s += 1) {
      var slice = books.slice(offset, offset + sizes[s]);
      offset += sizes[s];
      html += '<section class="books-shelf">';
      html += '<ul class="books-cover-row">';
      slice.forEach(function (book) {
        html += renderCover(book);
      });
      html += "</ul>";
      html += '<div class="books-shelf__board" aria-hidden="true"></div>';
      html += "</section>";
    }
    html += "</div></li>";
    return html;
  }

  function paint(books) {
    if (status) {
      status.remove();
      status = null;
    }
    root.setAttribute("data-books-mode", "covers");
    grid.className = "books-grid books-grid--covers";
    grid.innerHTML = renderShelves(books);
  }

  fetch("data/books.json")
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Could not load books");
      }
      return response.json();
    })
    .then(function (books) {
      if (!Array.isArray(books) || !books.length) {
        if (status) {
          status.textContent = "No books yet.";
        }
        return;
      }
      books.sort(function (a, b) {
        function deweyParts(raw) {
          var parts = String(raw || "999").split(".");
          var out = [];
          var i;
          for (i = 0; i < parts.length; i += 1) {
            var digits = String(parts[i]).replace(/\D/g, "");
            out.push(digits ? parseInt(digits, 10) : 0);
          }
          while (out.length < 3) {
            out.push(0);
          }
          return out;
        }
        var pa = deweyParts(a.dewey);
        var pb = deweyParts(b.dewey);
        var i;
        for (i = 0; i < pa.length; i += 1) {
          if (pa[i] < pb[i]) {
            return -1;
          }
          if (pa[i] > pb[i]) {
            return 1;
          }
        }
        var ta = a.title || "";
        var tb = b.title || "";
        if (ta < tb) {
          return -1;
        }
        if (ta > tb) {
          return 1;
        }
        return 0;
      });
      booksCache = books;
      paint(books);
    })
    .catch(function () {
      if (status) {
        status.textContent = "Couldn’t load the bookshelf.";
      }
    });

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    if (!booksCache) {
      return;
    }
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      paint(booksCache);
    }, 120);
  });
})();
