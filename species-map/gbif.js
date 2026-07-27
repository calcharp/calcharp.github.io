/** GBIF occurrence helpers for classroom map app. */
(function () {
  const GBIF = "https://api.gbif.org/v1";
  /** Soft ceiling on concurrent GBIF HTTP calls (shared across the page). */
  let GBIF_MAX_INFLIGHT = 3;
  let gbifInflight = 0;
  const gbifWaiters = [];
  /** After a 429/503, pause new GBIF requests until this timestamp. */
  let gbifCooldownUntil = 0;
  const matchCache = new Map();

  function setMaxInflight(n) {
    GBIF_MAX_INFLIGHT = Math.max(1, Math.min(8, Number(n) || 3));
    while (gbifWaiters.length && gbifInflight < GBIF_MAX_INFLIGHT) {
      gbifInflight += 1;
      const resolve = gbifWaiters.shift();
      if (resolve) resolve();
    }
  }

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  function acquireGbifSlot() {
    if (gbifInflight < GBIF_MAX_INFLIGHT) {
      gbifInflight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      gbifWaiters.push(resolve);
    });
  }

  function releaseGbifSlot() {
    gbifInflight = Math.max(0, gbifInflight - 1);
    if (gbifWaiters.length && gbifInflight < GBIF_MAX_INFLIGHT) {
      gbifInflight += 1;
      const next = gbifWaiters.shift();
      if (next) next();
    }
  }

  /**
   * fetch() wrapper with a global concurrency cap and Retry-After backoff on 429/503.
   */
  async function gbifFetchJson(url, { retries = 6 } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await acquireGbifSlot();
      try {
        const cool = gbifCooldownUntil - Date.now();
        if (cool > 0) await sleep(cool);
        const r = await fetch(url);
        if (r.status === 429 || r.status === 503) {
          const ra = Number(r.headers.get("Retry-After"));
          const delay = Number.isFinite(ra) && ra > 0
            ? Math.min(30000, ra * 1000)
            : Math.min(12000, 400 * 2 ** attempt + Math.random() * 200);
          gbifCooldownUntil = Date.now() + delay;
          lastErr = new Error(`GBIF rate limited (${r.status}). Retrying…`);
          continue;
        }
        if (!r.ok) throw new Error(`GBIF request failed (${r.status})`);
        return await r.json();
      } catch (e) {
        lastErr = e;
        // Network blips: brief backoff then retry
        if (attempt < retries && /failed to fetch|networkerror|load failed/i.test(String(e && e.message))) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw e;
      } finally {
        releaseGbifSlot();
      }
    }
    throw lastErr || new Error("GBIF request failed after retries.");
  }

  /** First still image from a GBIF occurrence, sized for map popups when possible. */
  function imageFromOccurrence(o) {
    const media = Array.isArray(o.media) ? o.media : [];
    for (const m of media) {
      const type = String(m.type || "");
      const format = String(m.format || "").toLowerCase();
      if (type && type !== "StillImage") continue;
      if (format && !format.startsWith("image/")) continue;
      let url = String(m.identifier || "").trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        url = String(m.references || "").trim();
      }
      if (!url || !/^https?:\/\//i.test(url)) continue;
      // iNat open-data originals are huge — prefer medium for the popup
      url = url
        .replace(/\/original\.(jpe?g|png|webp)(\?|$)/i, "/medium.$1$2")
        .replace(/\/large\.(jpe?g|png|webp)(\?|$)/i, "/medium.$1$2");
      return {
        url,
        credit: String(m.creator || m.rightsHolder || "").trim(),
        license: String(m.license || "").trim(),
      };
    }
    return null;
  }

  function recordFromOccurrence(o) {
    const lat = o.decimalLatitude;
    const lon = o.decimalLongitude;
    if (lat == null || lon == null) return null;
    const photo = imageFromOccurrence(o);
    return {
      lat,
      lon,
      year: o.year,
      month: o.month,
      locality: o.locality || o.county || o.country || "",
      county: o.county || "",
      stateProvince: o.stateProvince || "",
      country: o.country || o.countryCode || "",
      countryCode: o.countryCode || "",
      scientificName: o.species || o.scientificName || "",
      gbifID: o.key,
      basisOfRecord: o.basisOfRecord || "",
      elev_m: o.elevation,
      image_url: photo ? photo.url : null,
      image_credit: photo ? photo.credit : null,
      source_url: `https://www.gbif.org/occurrence/${o.key}`,
      source_name: "GBIF occurrence",
    };
  }

  function normalizeLabel(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[-_]/g, " ")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksLikeBinomial(query) {
    // "Genus species" (optional authorship junk) — treat as scientific first
    return /^[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(\s+[a-zà-öø-ÿ×.-]+)+$/.test(
      String(query || "").trim()
    );
  }

  /** Small edit distance for common typos (racoon → raccoon). */
  function editDistance(a, b) {
    const s = String(a || "");
    const t = String(b || "");
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const rows = s.length + 1;
    const cols = t.length + 1;
    const d = new Array(rows);
    for (let i = 0; i < rows; i++) {
      d[i] = new Array(cols);
      d[i][0] = i;
    }
    for (let j = 0; j < cols; j++) d[0][j] = j;
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + cost
        );
      }
    }
    return d[s.length][t.length];
  }

  function fuzzyEqual(a, b) {
    const x = normalizeLabel(a);
    const y = normalizeLabel(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const maxLen = Math.max(x.length, y.length);
    if (maxLen < 4) return false;
    const allowed = maxLen <= 5 ? 1 : maxLen <= 10 ? 1 : 2;
    return editDistance(x, y) <= allowed;
  }

  function resultFromMatch(j, query, via) {
    return {
      scientific: j.canonicalName || j.scientificName || query,
      taxonKey: j.usageKey,
      rank: j.rank,
      status: j.status,
      // Prefer our pathway label (INAT / VERNACULAR) over backbone EXACT/FUZZY
      matchType: via || j.matchType || "MATCH",
      confidence: j.confidence,
      common: via === "VERNACULAR" || via === "INAT" ? query : null,
      query,
    };
  }

  async function matchScientific(name) {
    const url = new URL(`${GBIF}/species/match`);
    url.searchParams.set("name", name);
    return gbifFetchJson(url.toString());
  }

  function preferredVernacular(item) {
    const verns = item.vernacularNames || [];
    const pref = verns.find((v) => v.preferred && v.vernacularName);
    if (pref) return normalizeLabel(pref.vernacularName);
    const en = verns.find(
      (v) =>
        v.vernacularName &&
        String(v.language || v.lang || "").toLowerCase().startsWith("en")
    );
    return en ? normalizeLabel(en.vernacularName) : null;
  }

  function vernacularScore(item, queryNorm) {
    const verns = item.vernacularNames || [];
    let bestExact = 0;
    let bestPartial = 0;
    let exactWasPreferred = false;

    for (const v of verns) {
      const vn = normalizeLabel(v.vernacularName);
      if (!vn) continue;
      if (vn === queryNorm || fuzzyEqual(vn, queryNorm)) {
        const sc = v.preferred ? 120 : 100;
        if (sc >= bestExact) {
          bestExact = sc;
          exactWasPreferred = !!v.preferred;
        }
      } else {
        const words = vn.split(" ");
        // Prefer whole-word hits over loose substring ("racoon" in "racoon tick")
        if (words.some((w) => w === queryNorm || fuzzyEqual(w, queryNorm))) {
          // Single-token preferred name that fuzzy-matches is strong; multi-word compounds weaker
          const sc = words.length === 1 ? 85 : 55;
          bestPartial = Math.max(bestPartial, sc);
        } else if (vn.includes(queryNorm) && queryNorm.length >= 4) {
          bestPartial = Math.max(bestPartial, 35);
        }
      }
    }

    let best = Math.max(bestExact, bestPartial);
    if (!best) return 0;

    const pref = preferredVernacular(item);
    if (pref) {
      if (pref === queryNorm || fuzzyEqual(pref, queryNorm)) best += 40;
      else if (pref.split(" ").length === 1 && fuzzyEqual(pref, queryNorm)) best += 30;
      // Exact hit only on an obscure synonym while preferred name is a long compound → demote
      if (bestExact && !exactWasPreferred && pref.split(" ").length >= 2) {
        const prefHasQuery = pref
          .split(" ")
          .some((w) => w === queryNorm || fuzzyEqual(w, queryNorm));
        if (prefHasQuery) best -= 45; // e.g. preferred "raccoon butterflyfish"
      }
    }

    if (item.rank === "SPECIES") best += 8;
    else if (item.rank === "SUBSPECIES") best += 2;
    const kingdom = String(item.kingdom || "");
    if (/animalia|plantae|fungi|metazoa/i.test(kingdom)) best += 3;
    if (item.taxonomicStatus === "ACCEPTED") best += 2;
    if (item.nubKey || item.speciesKey) best += 1;

    // Shorter preferred common names win ties ("raccoon" vs "raccoon butterflyfish")
    if (pref) best += Math.max(0, 6 - pref.split(" ").length);

    return best;
  }

  /**
   * iNaturalist is stronger at common-name / typo resolution than GBIF vernacular search.
   * Resolve to a scientific name, then map onto the GBIF backbone.
   */
  async function searchByiNat(query) {
    const queryNorm = normalizeLabel(query);
    if (!queryNorm) return null;
    const url = new URL("https://api.inaturalist.org/v1/taxa");
    url.searchParams.set("q", query);
    url.searchParams.set("is_active", "true");
    url.searchParams.set("per_page", "8");
    const r = await fetch(url);
    if (!r.ok) return null;
    const results = (await r.json()).results || [];
    if (!results.length) return null;

    const scored = results.map((t) => {
      let score = 0;
      const matched = normalizeLabel(t.matched_term);
      const common = normalizeLabel(t.preferred_common_name);
      const sci = normalizeLabel(t.name);
      if (matched === queryNorm) score += 120;
      else if (fuzzyEqual(matched, queryNorm)) score += 110;
      else if (matched.split(" ").some((w) => fuzzyEqual(w, queryNorm))) score += 50;
      if (common === queryNorm || fuzzyEqual(common, queryNorm)) score += 80;
      else if (common && common.split(" ").length === 1 && fuzzyEqual(common, queryNorm))
        score += 70;
      else if (common && common.split(" ").some((w) => fuzzyEqual(w, queryNorm))) {
        // Compound preferred name containing the query token — weaker
        score += 25;
      }
      if (sci === queryNorm) score += 90;
      if (t.rank === "species") score += 15;
      else if (t.rank === "subspecies") score += 5;
      if (common) score += Math.max(0, 6 - common.split(" ").length);
      return { t, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < 80) return null;

    const scientific = String(best.t.name || "").trim();
    if (!scientific) return null;
    const backbone = await matchScientific(scientific);
    if (!backbone.usageKey || backbone.matchType === "NONE") return null;
    const out = resultFromMatch(backbone, query, "INAT");
    out.common = best.t.preferred_common_name || query;
    out.confidence = best.score;
    return out;
  }

  async function searchByCommonName(query) {
    const queryNorm = normalizeLabel(query);
    if (!queryNorm) return null;

    async function runSearch(params) {
      const url = new URL(`${GBIF}/species/search`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      try {
        const j = await gbifFetchJson(url.toString());
        return j.results || [];
      } catch {
        return [];
      }
    }

    // Prefer vernacular field, then general search
    let results = await runSearch({
      q: query,
      qField: "VERNACULAR",
      limit: "20",
    });
    if (!results.length) {
      results = await runSearch({ q: query, limit: "20" });
    }
    if (!results.length) return null;

    const ranked = results
      .map((item) => ({ item, score: vernacularScore(item, queryNorm) }))
      .filter((x) => x.score >= 70)
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;

    const best = ranked[0].item;
    const scientific =
      best.canonicalName ||
      (best.species && String(best.species)) ||
      best.scientificName;
    if (!scientific) return null;

    // Resolve checklist/vernacular hit to GBIF backbone usageKey
    const backbone = await matchScientific(scientific);
    if (backbone.usageKey && backbone.matchType !== "NONE") {
      const out = resultFromMatch(backbone, query, "VERNACULAR");
      out.common = preferredVernacular(best) || query;
      out.confidence = ranked[0].score;
      return out;
    }

    const taxonKey = best.nubKey || best.speciesKey || best.key;
    if (!taxonKey) return null;
    return {
      scientific: scientific.replace(/\s+\([^)]*\)\s*$/, "").trim(),
      taxonKey,
      rank: best.rank || "SPECIES",
      status: best.taxonomicStatus || "",
      matchType: "VERNACULAR",
      confidence: ranked[0].score,
      common: preferredVernacular(best) || query,
      query,
    };
  }

  /**
   * Match a scientific or common name to a GBIF backbone taxon.
   * Common-name queries prefer iNaturalist (typos / vernaculars), then GBIF.
   * Binomial-looking queries prefer GBIF scientific match first.
   */
  async function matchSpecies(name) {
    const query = String(name || "").trim();
    if (!query) throw new Error("Enter a species name");
    const cacheKey = normalizeLabel(query);
    if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);

    const binomial = looksLikeBinomial(query);
    const j = await matchScientific(query);
    const solid =
      j.usageKey &&
      j.matchType &&
      j.matchType !== "NONE" &&
      (j.matchType === "EXACT" ||
        j.matchType === "FUZZY" ||
        (typeof j.confidence === "number" && j.confidence >= 90));

    // True scientific names: trust GBIF backbone first
    if (binomial && solid) {
      const out = resultFromMatch(j, query, j.matchType);
      matchCache.set(cacheKey, out);
      return out;
    }

    // Common names / typos: iNat first, then GBIF vernacular ranking
    try {
      const viaInat = await searchByiNat(query);
      if (viaInat) {
        matchCache.set(cacheKey, viaInat);
        return viaInat;
      }
    } catch {
      /* fall through */
    }

    const viaCommon = await searchByCommonName(query);
    if (viaCommon) {
      matchCache.set(cacheKey, viaCommon);
      return viaCommon;
    }

    if (solid) {
      const out = resultFromMatch(j, query, j.matchType);
      matchCache.set(cacheKey, out);
      return out;
    }

    if (j.usageKey && j.matchType && j.matchType !== "NONE") {
      const out = resultFromMatch(j, query, j.matchType);
      matchCache.set(cacheKey, out);
      return out;
    }

    throw new Error(`No GBIF match for “${query}”`);
  }

  /** Fast path for known scientific names (bulk taxonomy / similar species). */
  async function matchScientificName(name) {
    const query = String(name || "").trim();
    if (!query) throw new Error("Enter a species name");
    const cacheKey = `sci:${normalizeLabel(query)}`;
    if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);
    const j = await matchScientific(query);
    if (!j.usageKey || j.matchType === "NONE") {
      // Fall back to the fuller matcher for odd names
      return matchSpecies(query);
    }
    const out = resultFromMatch(j, query, j.matchType || "EXACT");
    matchCache.set(cacheKey, out);
    matchCache.set(normalizeLabel(query), out);
    return out;
  }

  async function fetchPage({ taxonKey, yearMin, offset, limit, basisOfRecord = null }) {
    const url = new URL(`${GBIF}/occurrence/search`);
    url.searchParams.set("taxonKey", String(taxonKey));
    url.searchParams.set("hasCoordinate", "true");
    url.searchParams.set("hasGeospatialIssue", "false");
    url.searchParams.set("occurrenceStatus", "PRESENT");
    url.searchParams.set("limit", String(Math.min(300, limit)));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("year", `${yearMin},2030`);
    const bases = Array.isArray(basisOfRecord)
      ? basisOfRecord.filter(Boolean)
      : basisOfRecord
        ? [basisOfRecord]
        : [];
    bases.forEach((b) => url.searchParams.append("basisOfRecord", String(b)));
    return gbifFetchJson(url.toString());
  }

  async function fetchOccurrencesFlat({
    taxonKey,
    maxRecords,
    yearMin,
    onProgress,
    onBatch,
    shouldParallelPages,
    basisOfRecord = null,
  }) {
    const pageSize = 300; // GBIF hard max per request
    const rows = [];
    const seen = new Set();
    const allowed =
      Array.isArray(basisOfRecord) && basisOfRecord.length
        ? new Set(basisOfRecord.map((b) => String(b).toUpperCase()))
        : null;

    function ingestPage(j) {
      const results = j.results || [];
      const batch = [];
      for (const o of results) {
        if (allowed) {
          const basis = String(o.basisOfRecord || "").toUpperCase();
          if (basis && !allowed.has(basis)) continue;
        }
        const rec = recordFromOccurrence(o);
        if (!rec) continue;
        const k = `${rec.lat.toFixed(5)},${rec.lon.toFixed(5)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        batch.push(rec);
        rows.push(rec);
        if (rows.length >= maxRecords) break;
      }
      if (batch.length && onBatch) onBatch(batch, rows.length);
      if (onProgress) onProgress(rows.length, Math.min(maxRecords, j.count || rows.length));
      return results.length;
    }

    // First page: get count + initial points
    const first = await fetchPage({
      taxonKey,
      yearMin,
      offset: 0,
      limit: Math.min(pageSize, maxRecords),
      basisOfRecord,
    });
    const got = ingestPage(first);
    if (!got || rows.length >= maxRecords) {
      return rows.slice(0, maxRecords);
    }

    const totalAvailable = Number(first.count) || 0;
    const target = Math.min(maxRecords, totalAvailable || maxRecords);
    if (got >= target || (totalAvailable && got >= totalAvailable)) {
      return rows.slice(0, maxRecords);
    }

    // Decide after the first round-trip so bulk jobs (3 species already
    // in flight) stay sequential-per-species under the shared slot cap.
    const parallelPages =
      typeof shouldParallelPages === "function" ? !!shouldParallelPages() : !!shouldParallelPages;

    if (parallelPages) {
      const offsets = [];
      for (let offset = pageSize; offset < target; offset += pageSize) {
        offsets.push(offset);
      }
      if (offsets.length) {
        await mapPool(offsets, offsets.length, async (offset) => {
          if (rows.length >= maxRecords) return;
          const need = Math.min(pageSize, target - offset);
          if (need <= 0) return;
          const j = await fetchPage({
            taxonKey,
            yearMin,
            offset,
            limit: need,
            basisOfRecord,
          });
          if (rows.length < maxRecords) ingestPage(j);
        });
      }
      return rows.slice(0, maxRecords);
    }

    let offset = pageSize;
    while (rows.length < maxRecords && offset < target) {
      const need = Math.min(pageSize, target - offset);
      const j = await fetchPage({
        taxonKey,
        yearMin,
        offset,
        limit: need,
        basisOfRecord,
      });
      const n = ingestPage(j);
      if (!n) break;
      offset += n;
      if (totalAvailable && offset >= totalAvailable) break;
    }
    return rows.slice(0, maxRecords);
  }

  /** How many species occurrence loads are in flight (for page-parallel decisions). */
  let activeOccurrenceFetches = 0;

  async function fetchOccurrences(opts) {
    const {
      taxonKey,
      maxRecords = 1000,
      yearMin = 2000,
      onProgress,
      onBatch,
      basisOfRecord = null,
    } = opts;

    const capped = Math.max(1, Math.min(5000, Number(maxRecords) || 1000));
    activeOccurrenceFetches += 1;
    try {
      return await fetchOccurrencesFlat({
        taxonKey,
        maxRecords: capped,
        yearMin,
        onProgress,
        onBatch,
        basisOfRecord,
        // Only fan out pages when this species is alone — bulk adds of
        // dozens/hundreds already keep the global HTTP slots busy.
        shouldParallelPages: () => activeOccurrenceFetches === 1,
      });
    } finally {
      activeOccurrenceFetches = Math.max(0, activeOccurrenceFetches - 1);
    }
  }

  /**
   * Run async work over items with a fixed concurrency (order of results matches input).
   */
  async function mapPool(items, concurrency, fn) {
    const list = items || [];
    const limit = Math.max(1, Math.min(concurrency || 1, list.length || 1));
    const out = new Array(list.length);
    let next = 0;
    async function worker() {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
    return out;
  }

  window.GBIF_API = { matchSpecies, matchScientificName, fetchOccurrences, mapPool, setMaxInflight };
})();
