/**
 * Resolve a species to a OneZoom tree pinpoint.
 * OneZoom pinpoints use `@=OTT` (note the equals), not `@OTT`.
 * Matching walks GBIF synonyms + higher taxa until search_node finds a hit.
 */
window.ONEZOOM_API = (() => {
  const OZ = "https://www.onezoom.org";
  const cache = new Map();

  function lifeUrl(ott, name) {
    if (!ott) return `${OZ}/`;
    if (name) {
      const pin = String(name).trim().replace(/\s+/g, "_");
      return `${OZ}/life/@${encodeURIComponent(pin)}=${ott}`;
    }
    return `${OZ}/life/@=${ott}`;
  }

  async function searchNode(query) {
    const q = String(query || "").trim();
    if (!q) return null;
    const url = `${OZ}/API/search_node.json?query=${encodeURIComponent(q)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const nodes = j.nodes || {};
    const headers = nodes.headers || {};
    const ottIdx = headers.ott != null ? headers.ott : 1;
    const nameIdx = headers.name != null ? headers.name : 2;
    const leaf = (nodes.leaf_hits || [])[0];
    if (leaf) {
      return { ott: leaf[ottIdx], name: leaf[nameIdx], kind: "leaf" };
    }
    const node = (nodes.node_hits || [])[0];
    if (node) {
      return { ott: node[ottIdx], name: node[nameIdx], kind: "node" };
    }
    return null;
  }

  async function ottFromGbif(taxonKey) {
    if (!taxonKey) return null;
    const r = await fetch(`${OZ}/API/getOTT.json?gbif=${taxonKey}`);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.gbif && j.gbif[String(taxonKey)]) || null;
  }

  async function gbifContext(taxonKey) {
    if (!taxonKey) return null;
    const [sp, nameUsage] = await Promise.all([
      fetch(`https://api.gbif.org/v1/species/${taxonKey}`).then((r) => r.json()),
      fetch(`https://api.gbif.org/v1/species/${taxonKey}/name`).then((r) =>
        r.ok ? r.json() : null
      ).catch(() => null),
    ]);
    const synonyms = await fetch(
      `https://api.gbif.org/v1/species/${taxonKey}/synonyms?limit=20`
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    const names = [];
    const add = (n) => {
      const s = String(n || "").trim();
      // Prefer canonical binomial without authorship
      if (!s) return;
      if (!names.includes(s)) names.push(s);
    };
    add(sp.canonicalName);
    add(sp.scientificName);
    add(nameUsage && nameUsage.canonicalName);
    const synList = Array.isArray(synonyms)
      ? synonyms
      : (synonyms && synonyms.results) || [];
    synList.forEach((syn) => {
      add(syn.canonicalName);
      add(syn.scientificName);
    });

    const ladder = [];
    const ranks = [
      ["species", sp.key, sp.canonicalName || sp.scientificName],
      ["genus", sp.genusKey, sp.genus],
      ["family", sp.familyKey, sp.family],
      ["order", sp.orderKey, sp.order],
      ["class", sp.classKey, sp.class],
      ["phylum", sp.phylumKey, sp.phylum],
      ["kingdom", sp.kingdomKey, sp.kingdom],
    ];
    for (const [rank, key, name] of ranks) {
      if (key || name) ladder.push({ rank, key, name });
    }
    return { names, ladder, species: sp };
  }

  /**
   * @returns {Promise<{url:string, ott?:number, name?:string, matched?:string}>}
   */
  async function resolve(sp) {
    const cacheKey = String(sp.taxonKey || sp.scientific || "").toLowerCase();
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const pending = (async () => {
      const queries = [];
      const seenQ = new Set();
      const pushQ = (q) => {
        const s = String(q || "").trim();
        if (!s) return;
        const k = s.toLowerCase();
        if (seenQ.has(k)) return;
        seenQ.add(k);
        queries.push(s);
      };

      // Prefer iNaturalist-matched scientific name when available (better synonyms / fuzzy)
      pushQ(sp.inatName);
      pushQ(sp.scientific);
      pushQ(sp.common);

      let ctx = null;
      try {
        if (sp.taxonKey) ctx = await gbifContext(sp.taxonKey);
      } catch {
        ctx = null;
      }
      if (ctx) {
        ctx.names.forEach(pushQ);
        ctx.ladder.forEach((r) => pushQ(r.name));
      }

      // 1) OneZoom text search (handles synonym names like Cercopithecus solatus)
      for (const q of queries) {
        try {
          const hit = await searchNode(q);
          if (hit && hit.ott) {
            return {
              url: lifeUrl(hit.ott, hit.name),
              ott: hit.ott,
              name: hit.name,
              matched: q,
              kind: hit.kind,
            };
          }
        } catch {
          /* continue */
        }
      }

      // 2) GBIF key → OTT, walking up the classification
      const gbifKeys = [];
      if (sp.taxonKey) gbifKeys.push(sp.taxonKey);
      if (ctx) {
        ctx.ladder.forEach((r) => {
          if (r.key && !gbifKeys.includes(r.key)) gbifKeys.push(r.key);
        });
      }
      for (const key of gbifKeys) {
        try {
          const ott = await ottFromGbif(key);
          if (ott) {
            // Prefer pairing with a searchable name at this rank
            const rank = ctx && ctx.ladder.find((r) => r.key === key);
            const name = (rank && rank.name) || sp.inatName || sp.scientific;
            // Verify via search when possible
            const verified = name ? await searchNode(name) : null;
            if (verified && verified.ott) {
              return {
                url: lifeUrl(verified.ott, verified.name),
                ott: verified.ott,
                name: verified.name,
                matched: name,
                kind: verified.kind,
              };
            }
            return {
              url: lifeUrl(ott, null),
              ott,
              name: null,
              matched: String(key),
              kind: "gbif-ott",
            };
          }
        } catch {
          /* continue */
        }
      }

      // Last resort: name pin (may land on root with error)
      const pinName = String(sp.inatName || sp.scientific || "")
        .trim()
        .replace(/\s+/g, "_");
      return {
        url: pinName ? `${OZ}/life/@${encodeURIComponent(pinName)}` : `${OZ}/`,
        matched: null,
      };
    })();

    cache.set(cacheKey, pending);
    return pending;
  }

  return { resolve, lifeUrl };
})();
