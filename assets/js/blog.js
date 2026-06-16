(function () {
  var RSS_URL = "https://calebcharpentier.substack.com/feed";
  var SUBSTACK_URL = "https://calebcharpentier.substack.com/";
  var API_URL =
    "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(RSS_URL);
  var feedEl = document.getElementById("blog-feed");

  if (!feedEl) {
    return;
  }

  function stripHtml(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(dateString) {
    var date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  function getThumbnail(item) {
    if (item.thumbnail) {
      return item.thumbnail;
    }
    if (item.enclosure && item.enclosure.link) {
      return item.enclosure.link;
    }
    var match = (item.content || "").match(/<img[^>]+src="([^"]+)"/i);
    return match ? match[1] : "";
  }

  function renderPosts(items) {
    feedEl.innerHTML = items
      .map(function (item) {
        var excerpt = stripHtml(item.description || item.content);
        var thumbnail = getThumbnail(item);
        var imageHtml = thumbnail
          ? '<div class="blog-preview__media"><img class="blog-preview__image" src="' +
            thumbnail +
            '" alt="" loading="lazy"></div>'
          : "";

        return (
          '<article class="blog-preview">' +
          imageHtml +
          '<div class="blog-preview__body">' +
          '<p class="blog-preview__date">' +
          formatDate(item.pubDate) +
          "</p>" +
          '<h2 class="blog-preview__title"><a href="' +
          item.link +
          '" target="_blank" rel="noopener">' +
          escapeHtml(item.title) +
          "</a></h2>" +
          (excerpt ? '<p class="blog-preview__excerpt">' + escapeHtml(excerpt) + "</p>" : "") +
          '<a class="blog-preview__link" href="' +
          item.link +
          '" target="_blank" rel="noopener">Read on Substack →</a>' +
          "</div></article>"
        );
      })
      .join("");
  }

  function renderEmpty() {
    feedEl.innerHTML =
      '<div class="blog-empty">' +
      "<p>No posts yet. Subscribe on Substack to get notified when I publish.</p>" +
      '<p><a href="' +
      SUBSTACK_URL +
      '" target="_blank" rel="noopener">Evolution and AI on Substack →</a></p>' +
      "</div>";
  }

  function renderError() {
    feedEl.innerHTML =
      '<div class="blog-empty">' +
      "<p>Could not load posts right now.</p>" +
      '<p><a href="' +
      SUBSTACK_URL +
      '" target="_blank" rel="noopener">Visit Evolution and AI on Substack →</a></p>' +
      "</div>";
  }

  fetch(API_URL)
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (data.status !== "ok" || !data.items) {
        renderError();
        return;
      }

      if (data.items.length === 0) {
        renderEmpty();
        return;
      }

      renderPosts(data.items);
    })
    .catch(function () {
      renderError();
    });
})();
