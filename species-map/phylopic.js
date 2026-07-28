/**
 * PhyloPic silhouette lookup (API v2).
 * Classroom-friendly licenses only (display + link to PhyloPic):
 * CC0 / Public Domain, CC BY, CC BY-SA, and NC variants (BY-NC, BY-NC-SA, …).
 * Teaching use is non-commercial, so NC silhouettes (e.g. Adélie penguin) are OK.
 * Rejects unknown / missing license hrefs.
 *
 * Resolution order prefers PhyloPic name/genus matches over GBIF ID resolve.
 * Incomplete GBIF lineages often only match Animalia/Metazoa, whose primary
 * image can be an unrelated fossil (e.g. Vaveliksia for a gecko).
 */
window.PHYLOPIC_API = (() => {
  const API = "https://api.phylopic.org";
  const SITE = "https://www.phylopic.org";
  const cache = new Map();
  let buildPromise = null;

  /** Kingdom / domain-level (and a few ultra-broad) PhyloPic nodes — never use their silhouettes. */
  const COARSE_TAXA = new Set([
    "metazoa",
    "animalia",
    "plantae",
    "fungi",
    "eukaryota",
    "biota",
    "chromista",
    "protista",
    "bacteria",
    "archaea",
    "viruses",
    "virus",
    "chordata",
    "vertebrata",
    "embryophyta",
    "tracheophyta",
  ]);

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
    // CC BY* including NC / ND (we only display + deep-link; attribution via PhyloPic)
    if (/\/licenses\/by(?:-nc)?(?:-nd)?(?:-sa)?\//.test(h)) return true;
    return false;
  }

  function nodeNameTexts(node) {
    const out = [];
    const push = (t) => {
      const s = String(t || "")
        .trim()
        .toLowerCase();
      if (s) out.push(s);
    };
    push(node && node._links && node._links.self && node._links.self.title);
    for (const group of (node && node.names) || []) {
      const arr = Array.isArray(group) ? group : [group];
      for (const n of arr) {
        if (n && (n.class === "scientific" || n.class === "vernacular")) push(n.text);
      }
    }
    return out;
  }

  function isCoarseNode(node) {
    if (!node || !node.uuid) return true;
    return nodeNameTexts(node).some((n) => COARSE_TAXA.has(n));
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

  function licenseLabel(href) {
    const h = String(href || "").toLowerCase();
    if (!h) return "Unknown license";
    if (h.includes("/zero/") || h.includes("publicdomain/zero")) return "CC0 1.0 (Public Domain)";
    if (h.includes("publicdomain")) return "Public Domain";
    if (h.includes("/by-nc-sa/")) return "CC BY-NC-SA";
    if (h.includes("/by-nc-nd/")) return "CC BY-NC-ND";
    if (h.includes("/by-nc/")) return "CC BY-NC";
    if (h.includes("/by-sa/")) return "CC BY-SA";
    if (h.includes("/by-nd/")) return "CC BY-ND";
    if (h.includes("/by/")) return "CC BY";
    return "Open license";
  }

  function imageFromMeta(img) {
    if (!img || !img.uuid) return null;
    const links = img._links || {};
    const licenseHref = links.license && links.license.href;
    if (!licenseOk(licenseHref)) return null;
    const thumbs = links.thumbnailFiles || [];
    const rasters = links.rasterFiles || [];
    // Prefer 192/64 over 128: some 128px PhyloPic thumbs fail browser CORS
    // fetches (CSS masks need that), which leaves a blank but still-clickable icon.
    // Some images also block CORS on all thumbnail sizes while still allowing
    // raster/* — keep mid-size rasters as fallbacks.
    const preferredThumbs = [
      thumbs.find((t) => (t.sizes || "").startsWith("192")),
      thumbs.find((t) => (t.sizes || "").startsWith("64")),
      thumbs.find((t) => (t.sizes || "").startsWith("128")),
      thumbs[0],
    ].filter(Boolean);
    const rasterByWidth = (min, max) =>
      rasters.find((t) => {
        const w = parseInt(String(t.sizes || "").split("x")[0], 10);
        return Number.isFinite(w) && w >= min && w <= max;
      });
    const preferredRasters = [
      rasterByWidth(256, 512),
      rasterByWidth(128, 1024),
      rasters[rasters.length - 1],
    ].filter(Boolean);

    const thumbUrls = [];
    const seen = new Set();
    const push = (u) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      thumbUrls.push(u);
    };
    preferredThumbs.forEach((t) => push(t && t.href));
    preferredRasters.forEach((t) => push(t && t.href));

    const src = thumbUrls[0];
    if (!src) return null;
    // Image.attribution is the credit line artists request (may list many authors).
    // links.contributor is often the PhyloPic uploader, not the silhouette artist.
    const credit = String(img.attribution || "").trim()
      || (links.contributor && links.contributor.title)
      || null;
    const contributor = (links.contributor && links.contributor.title) || null;
    const taxonTitle =
      (links.self && links.self.title)
      || (links.specificNode && links.specificNode.title)
      || null;
    return {
      uuid: img.uuid,
      src,
      thumbUrls,
      pageUrl: `${SITE}/images/${img.uuid}`,
      license: licenseHref,
      licenseLabel: licenseLabel(licenseHref),
      attribution: credit,
      contributor,
      taxonTitle,
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
    if (!node || isCoarseNode(node)) return null;
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
        if (isCoarseNode(node)) return null;
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

  async function resolveGbifObjectId(objectId, build) {
    const url = new URL(`${API}/resolve/gbif.org/species`);
    url.searchParams.set("build", build);
    url.searchParams.set("objectIDs", String(objectId));
    const r = await fetch(url);
    if (!r.ok) return null;
    const node = await r.json();
    return isCoarseNode(node) ? null : node;
  }

  /**
   * Resolve via GBIF → PhyloPic, most-specific ID first.
   * Never accept kingdom/domain-level nodes (wrong silhouettes).
   */
  async function nodeFromGbif(taxonKey, build) {
    if (!taxonKey) return null;
    try {
      const sp = await fetch(`https://api.gbif.org/v1/species/${taxonKey}`).then((r) =>
        r.json()
      );
      const ids = ["key", "genusKey", "familyKey", "orderKey", "classKey", "phylumKey"]
        .map((k) => sp[k])
        .filter(Boolean);
      // Intentionally omit kingdomKey — Animalia → Metazoa fossil silhouettes
      for (const id of ids) {
        const node = await resolveGbifObjectId(id, build);
        if (node) return node;
      }
      return null;
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
    const node = items[0] || null;
    return isCoarseNode(node) ? null : node;
  }

  async function imageForNode(node, build) {
    if (!node) return null;
    return pickLicensedImage(node, build);
  }

  /**
   * @param {{scientific?:string, names?:string[], taxonKey?:number|string}} opts
   * @returns {Promise<null|{uuid,src,pageUrl,license,attribution}>}
   */
  async function findSilhouette({ scientific, names, taxonKey } = {}) {
    const tryNames = [];
    const seen = new Set();
    const pushName = (n) => {
      const s = String(n || "").trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      tryNames.push(s);
    };
    (Array.isArray(names) ? names : []).forEach(pushName);
    pushName(scientific);

    const cacheKey = String(taxonKey || tryNames[0] || "").toLowerCase();
    if (!cacheKey) return null;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const pending = (async () => {
      try {
        const build = await getBuild();

        // 1) Exact / provided names on PhyloPic (species-level when present)
        for (const n of tryNames) {
          const img = await imageForNode(await nodeFromName(n, build), build);
          if (img) return img;
        }

        // 2) Genus of the preferred scientific name (common when species missing on PhyloPic)
        for (const n of tryNames) {
          const genus = normalizeName(n).split(" ")[0];
          if (!genus || genus === normalizeName(n)) continue;
          const img = await imageForNode(await nodeFromName(genus, build), build);
          if (img) return img;
        }

        // 3) GBIF ID resolve — specific → broad, never kingdom
        return await imageForNode(await nodeFromGbif(taxonKey, build), build);
      } catch {
        return null;
      }
    })();

    cache.set(cacheKey, pending);
    return pending;
  }

  return { findSilhouette, licenseOk };
})();
