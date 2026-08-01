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

  var encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  var decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

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

  function bytesToText(bytes) {
    if (decoder) {
      return decoder.decode(bytes);
    }
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }

  function featureLink(features) {
    if (!Array.isArray(features)) {
      return null;
    }
    for (var i = 0; i < features.length; i += 1) {
      var feature = features[i] || {};
      var type = String(feature.$type || "");
      if (type.indexOf("app.bsky.richtext.facet#link") === 0 && feature.uri) {
        return { href: feature.uri, kind: "link" };
      }
      if (type.indexOf("app.bsky.richtext.facet#mention") === 0 && feature.did) {
        return {
          href: "https://bsky.app/profile/" + encodeURIComponent(feature.did),
          kind: "mention"
        };
      }
      if (type.indexOf("app.bsky.richtext.facet#tag") === 0 && feature.tag) {
        return {
          href: "https://bsky.app/hashtag/" + encodeURIComponent(feature.tag),
          kind: "tag"
        };
      }
    }
    return null;
  }

  function renderRichText(text, facets) {
    var raw = String(text || "");
    if (!raw) {
      return "";
    }
    if (!encoder || !Array.isArray(facets) || !facets.length) {
      return escapeHtml(raw);
    }

    var bytes = encoder.encode(raw);
    var ranges = facets
      .map(function (facet) {
        var index = facet && facet.index ? facet.index : null;
        var link = featureLink(facet && facet.features);
        if (!index || !link) {
          return null;
        }
        var start = Number(index.byteStart);
        var end = Number(index.byteEnd);
        if (!isFinite(start) || !isFinite(end) || end <= start || start < 0 || end > bytes.length) {
          return null;
        }
        return { start: start, end: end, href: link.href, kind: link.kind };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.start - b.start;
      });

    var html = "";
    var cursor = 0;

    ranges.forEach(function (range) {
      if (range.start < cursor) {
        return;
      }
      if (range.start > cursor) {
        html += escapeHtml(bytesToText(bytes.slice(cursor, range.start)));
      }
      var label = escapeHtml(bytesToText(bytes.slice(range.start, range.end)));
      html +=
        '<a class="bluesky-feed__inline-link bluesky-feed__inline-link--' +
        escapeHtml(range.kind) +
        '" href="' +
        escapeHtml(range.href) +
        '" target="_blank" rel="noopener">' +
        label +
        "</a>";
      cursor = range.end;
    });

    if (cursor < bytes.length) {
      html += escapeHtml(bytesToText(bytes.slice(cursor)));
    }

    return html;
  }

  function extractImages(embed) {
    if (!embed || !embed.$type) {
      return [];
    }
    var type = String(embed.$type);
    if (type.indexOf("app.bsky.embed.images") === 0) {
      return (embed.images || [])
        .map(function (image) {
          return {
            src: image.thumb || image.fullsize || "",
            alt: image.alt || ""
          };
        })
        .filter(function (image) {
          return Boolean(image.src);
        });
    }
    if (type.indexOf("app.bsky.embed.recordWithMedia") === 0) {
      return extractImages(embed.media);
    }
    return [];
  }

  function extractExternal(embed) {
    if (!embed || !embed.$type) {
      return null;
    }
    var type = String(embed.$type);
    if (type.indexOf("app.bsky.embed.external") === 0 && embed.external) {
      return {
        uri: embed.external.uri || "",
        title: embed.external.title || embed.external.uri || "Link",
        description: embed.external.description || "",
        thumb: embed.external.thumb || ""
      };
    }
    if (type.indexOf("app.bsky.embed.recordWithMedia") === 0) {
      return extractExternal(embed.media);
    }
    return null;
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

  function renderImages(images) {
    if (!images.length) {
      return "";
    }
    return (
      '<div class="bluesky-feed__media' +
      (images.length > 1 ? " bluesky-feed__media--multi" : "") +
      '">' +
      images
        .map(function (image) {
          return (
            '<img class="bluesky-feed__image" src="' +
            escapeHtml(image.src) +
            '" alt="' +
            escapeHtml(image.alt) +
            '" loading="lazy">'
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderExternal(external) {
    if (!external || !external.uri) {
      return "";
    }
    return (
      '<a class="bluesky-feed__embed" href="' +
      escapeHtml(external.uri) +
      '" target="_blank" rel="noopener">' +
      (external.thumb
        ? '<img class="bluesky-feed__embed-thumb" src="' +
          escapeHtml(external.thumb) +
          '" alt="" loading="lazy">'
        : "") +
      '<span class="bluesky-feed__embed-body">' +
      '<span class="bluesky-feed__embed-title">' +
      escapeHtml(external.title) +
      "</span>" +
      (external.description
        ? '<span class="bluesky-feed__embed-desc">' + escapeHtml(external.description) + "</span>"
        : "") +
      '<span class="bluesky-feed__embed-url">' +
      escapeHtml(external.uri.replace(/^https?:\/\//, "")) +
      "</span>" +
      "</span>" +
      "</a>"
    );
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
      var textHtml = renderRichText(record.text || "", record.facets || []);
      var when = formatDate(record.createdAt || post.indexedAt);
      var permalink = postUrl(post);
      var images = extractImages(post.embed);
      var external = extractExternal(post.embed);

      html +=
        '<li class="bluesky-feed__item">' +
        '<article class="bluesky-feed__card">' +
        (textHtml ? '<p class="bluesky-feed__text">' + textHtml + "</p>" : "") +
        renderImages(images) +
        renderExternal(external) +
        (when
          ? '<a class="bluesky-feed__meta" href="' +
            escapeHtml(permalink) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(when) +
            "</a>"
          : "") +
        "</article>" +
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
