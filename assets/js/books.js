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
    var html = '<li class="books-case"><div class="books-case__inner">';
    var i;
    for (i = 0; i < books.length; i += cols) {
      var slice = books.slice(i, i + cols);
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
        var da = a.dewey || "999";
        var db = b.dewey || "999";
        if (da < db) {
          return -1;
        }
        if (da > db) {
          return 1;
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
