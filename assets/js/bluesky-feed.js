(function () {
  var root = document.querySelector(".bluesky-feed[data-handle]");
  if (!root) {
    return;
  }

  var handle = root.getAttribute("data-handle") || "calcharp.bsky.social";
  var limit = parseInt(root.getAttribute("data-limit") || "3", 10);
  if (!limit || limit < 1) {
    limit = 3;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function postUrl(post) {
    var uri = post.uri || "";
    var rkey = uri.split("/").pop();
    var authorHandle = (post.author && post.author.handle) || handle;
    return "https://bsky.app/profile/" + encodeURIComponent(authorHandle) + "/post/" + encodeURIComponent(rkey);
  }

  function formatDate(iso) {
    if (!iso) {
      return "";
    }
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function truncate(text, max) {
    var cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (cleaned.length <= max) {
      return cleaned;
    }
    return cleaned.slice(0, max - 1).trimEnd() + "…";
  }

  function extractImages(embed) {
    if (!embed || !embed.$type) {
      return [];
    }
    var type = String(embed.$type);
    if (type.indexOf("app.bsky.embed.images") === 0) {
      return (embed.images || [])
        .map(function (image) {
          return image.thumb || image.fullsize || "";
        })
        .filter(Boolean);
    }
    if (type.indexOf("app.bsky.embed.recordWithMedia") === 0) {
      return extractImages(embed.media);
    }
    return [];
  }

  function isOriginalPost(item) {
    if (!item || !item.post) {
      return false;
    }
    if (item.reason) {
      return false;
    }
    var post = item.post;
    var record = post.record || {};
    if (record.reply) {
      return false;
    }
    var authorHandle = post.author && post.author.handle;
    return authorHandle === handle;
  }

  function renderItems(items) {
    if (!items.length) {
      root.innerHTML =
        '<p class="bluesky-feed__status">No original posts yet. <a href="https://bsky.app/profile/' +
        encodeURIComponent(handle) +
        '" target="_blank" rel="noopener">Open Bluesky</a></p>';
      return;
    }

    var html = '<ul class="bluesky-feed__list">';
    items.forEach(function (item) {
      var post = item.post;
      var record = post.record || {};
      var text = truncate(record.text || "", 160);
      var when = formatDate(record.createdAt || post.indexedAt);
      var images = extractImages(post.embed);
      var imageHtml = "";

      if (images.length) {
        imageHtml =
          '<span class="bluesky-feed__media">' +
          '<img class="bluesky-feed__image" src="' +
          escapeHtml(images[0]) +
          '" alt="" loading="lazy" width="640" height="360">' +
          (images.length > 1
            ? '<span class="bluesky-feed__media-count">+' + (images.length - 1) + "</span>"
            : "") +
          "</span>";
      }

      html +=
        '<li class="bluesky-feed__item">' +
        '<a class="bluesky-feed__link" href="' +
        escapeHtml(postUrl(post)) +
        '" target="_blank" rel="noopener">' +
        imageHtml +
        (text ? '<span class="bluesky-feed__text">' + escapeHtml(text) + "</span>" : "") +
        (when ? '<span class="bluesky-feed__meta">' + escapeHtml(when) + "</span>" : "") +
        "</a>" +
        "</li>";
    });
    html += "</ul>";
    root.innerHTML = html;
  }

  function fetchPage(cursor) {
    var endpoint =
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed" +
      "?actor=" +
      encodeURIComponent(handle) +
      "&filter=posts_no_replies" +
      "&limit=30";
    if (cursor) {
      endpoint += "&cursor=" + encodeURIComponent(cursor);
    }
    return fetch(endpoint).then(function (response) {
      if (!response.ok) {
        throw new Error("Feed request failed");
      }
      return response.json();
    });
  }

  function collectOriginals(cursor, collected, pagesLeft) {
    return fetchPage(cursor).then(function (data) {
      var feed = Array.isArray(data.feed) ? data.feed : [];
      feed.forEach(function (item) {
        if (collected.length < limit && isOriginalPost(item)) {
          collected.push(item);
        }
      });

      if (collected.length >= limit || !data.cursor || pagesLeft <= 1 || !feed.length) {
        return collected;
      }
      return collectOriginals(data.cursor, collected, pagesLeft - 1);
    });
  }

  collectOriginals(null, [], 4)
    .then(function (items) {
      renderItems(items.slice(0, limit));
    })
    .catch(function () {
      root.innerHTML =
        '<p class="bluesky-feed__status">Couldn’t load posts. <a href="https://bsky.app/profile/' +
        encodeURIComponent(handle) +
        '" target="_blank" rel="noopener">Open Bluesky</a></p>';
    });
})();
