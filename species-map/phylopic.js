/**
 * PhyloPic silhouette lookup (API v2).
 * Only returns images with classroom-friendly licenses:
 * CC0 / Public Domain, CC BY, CC BY-SA (no NC / ND-only / unknown).
 */
window.PHYLOPIC_API = (() => {
  const API = "https://api.phylopic.org";
  const SITE = "https://www.phylopic.org";
  const cache = new Map();
  let buildPromise = null;

  function normalizeName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function licenseOk(href) {
    if (!href) return false;
    const h = String(href).toLowerCase();
    if (h.includes("publicdomain") || h.includes("/zero/")) return true;
    // Allow BY and BY-SA (attribution OK — we link to the PhyloPic page)
    if (/\/licenses\/by(?:-sa)?\//.test(h)) return true;
    return false;
  }

  async function getBuild() {
    if (!buildPromise) {
      buildPromise = fetch(`${API}/`)
        .then((r) => r.json())
        .then((j) => j.build)
        .catch((e) => {
          buildPromise = null;
          throw e;
        });
    }
    return buildPromise;
  }

  function imageFromMeta(img) {
    if (!img || !img.uuid) return null;
    const links = img._links || {};
    const licenseHref = links.license && links.license.href;
    if (!licenseOk(licenseHref)) return null;
    const thumbs = links.thumbnailFiles || [];
    const thumb =
      thumbs.find((t) => (t.sizes || "").startsWith("128")) ||
      thumbs.find((t) => (t.sizes || "").startsWith("192")) ||
      thumbs[0];
    const vector = links.vectorFile;
    const src = (thumb && thumb.href) || (vector && vector.href);
    if (!src) return null;
    return {
      uuid: img.uuid,
      src,
      pageUrl: `${SITE}/images/${img.uuid}`,
      license: licenseHref,
      attribution: (links.contributor && links.contributor.title) || null,
    };
  }

  async function imagesForClade(nodeUuid, build) {
    const url = new URL(`${API}/images`);
    url.searchParams.set("build", build);
    url.searchParams.set("embed_items", "true");
    url.searchParams.set("filter_clade", nodeUuid);
    url.searchParams.set("page", "0");
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return (j._embedded && j._embedded.items) || [];
  }

  async function pickLicensedImage(node, build) {
    if (!node) return null;
    // Prefer primary image when license is OK
    let primary = node._embedded && node._embedded.primaryImage;
    if (!primary && node.uuid) {
      const r = await fetch(
        `${API}/nodes/${node.uuid}?build=${build}&embed_primaryImage=true`
      );
      if (r.ok) {
        const full = await r.json();
        primary = full._embedded && full._embedded.primaryImage;
        node = full;
      }
    }
    const fromPrimary = imageFromMeta(primary);
    if (fromPrimary) return fromPrimary;

    const imgs = await imagesForClade(node.uuid, build);
    for (const img of imgs) {
      const ok = imageFromMeta(img);
      if (ok) return ok;
    }
    return null;
  }

  async function nodeFromGbif(taxonKey, build) {
    if (!taxonKey) return null;
    try {
      const sp = await fetch(`https://api.gbif.org/v1/species/${taxonKey}`).then((r) =>
        r.json()
      );
      const ids = ["key", "genusKey", "familyKey", "orderKey", "classKey", "phylumKey", "kingdomKey"]
        .map((k) => sp[k])
        .filter(Boolean);
      if (!ids.length) return null;
      const url = new URL(`${API}/resolve/gbif.org/species`);
      url.searchParams.set("build", build);
      url.searchParams.set("objectIDs", ids.join(","));
      const r = await fetch(url);
      if (!r.ok) return null;
      return r.json();
    } catch {
      return null;
    }
  }

  async function nodeFromName(name, build) {
    const q = normalizeName(name);
    if (!q) return null;
    const url = new URL(`${API}/nodes`);
    url.searchParams.set("build", build);
    url.searchParams.set("filter_name", q);
    url.searchParams.set("embed_items", "true");
    url.searchParams.set("page", "0");
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const items = (j._embedded && j._embedded.items) || [];
    return items[0] || null;
  }

  /**
   * @returns {Promise<null|{uuid,src,pageUrl,license,attribution}>}
   */
  async function findSilhouette({ scientific, taxonKey } = {}) {
    const cacheKey = String(taxonKey || scientific || "").toLowerCase();
    if (!cacheKey) return null;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const pending = (async () => {
      try {
        const build = await getBuild();
        let node = await nodeFromGbif(taxonKey, build);
        if (!node) node = await nodeFromName(scientific, build);
        if (!node && scientific) {
          // try genus
          const genus = normalizeName(scientific).split(" ")[0];
          if (genus) node = await nodeFromName(genus, build);
        }
        return await pickLicensedImage(node, build);
      } catch {
        return null;
      }
    })();

    cache.set(cacheKey, pending);
    return pending;
  }

  return { findSilhouette, licenseOk };
})();
