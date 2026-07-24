/**
 * iNaturalist taxonomy helpers: lineages from /taxa/{id} ancestors,
 * merged taxonomy tree among mapped species, and similar-species lookup.
 */
window.INAT_TAXONOMY = (() => {
  const BASE = "https://api.inaturalist.org/v1";

  function tipKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\s+/g, " ");
  }

  async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`iNaturalist error (${r.status})`);
    return r.json();
  }

  async function fetchTaxaByIds(ids) {
    const unique = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    const out = new Map();
    const chunk = 30;
    for (let i = 0; i < unique.length; i += chunk) {
      const slice = unique.slice(i, i + chunk);
      const data = await getJson(`${BASE}/taxa/${slice.join(",")}`);
      (data.results || []).forEach((t) => out.set(Number(t.id), t));
    }
    return out;
  }

  /** Full ancestry path from kingdom → tip (iNat order). */
  function ancestryPath(taxon) {
    const path = [];
    (taxon.ancestors || []).forEach((a) => {
      if (!a || a.id == null) return;
      path.push({
        id: Number(a.id),
        rank: String(a.rank || "").toLowerCase(),
        name: String(a.name || "").trim(),
        common: String(a.preferred_common_name || "").trim(),
      });
    });
    path.push({
      id: Number(taxon.id),
      rank: String(taxon.rank || "").toLowerCase(),
      name: String(taxon.name || "").trim(),
      common: String(taxon.preferred_common_name || "").trim(),
      isTip: true,
    });
    return path.filter((n) => n.name);
  }

  /**
   * Merge ancestry paths into a tree keyed by iNat taxon id.
   * Tips keep a reference to the mapped species for color/label.
   */
  function mergeAncestryTree(lineages) {
    const root = { id: null, rank: "", name: "", common: "", children: [], _map: new Map(), tips: [] };

    function ensureChild(parent, node) {
      if (!parent._map.has(node.id)) {
        const child = {
          id: node.id,
          rank: node.rank,
          name: node.name,
          common: node.common,
          children: [],
          _map: new Map(),
          tips: [],
        };
        parent._map.set(node.id, child);
        parent.children.push(child);
      } else {
        const existing = parent._map.get(node.id);
        if (!existing.common && node.common) existing.common = node.common;
      }
      return parent._map.get(node.id);
    }

    lineages.forEach((lin) => {
      let cur = root;
      (lin.path || []).forEach((step, idx) => {
        cur = ensureChild(cur, step);
        if (idx === lin.path.length - 1) {
          cur.tips.push(lin);
          cur.isTip = true;
        }
      });
    });

    function finalize(n) {
      delete n._map;
      n.children.forEach(finalize);
    }
    finalize(root);
    return root.children.length === 1 ? root.children[0] : root;
  }

  /**
   * Similar species — same endpoint as iNat’s Similar Species tab.
   */
  async function similarSpecies(inatId, { perPage = 12 } = {}) {
    const id = Number(inatId);
    if (!Number.isFinite(id)) return [];
    const url = new URL(`${BASE}/identifications/similar_species`);
    url.searchParams.set("taxon_id", String(id));
    const data = await getJson(url.toString());
    const items = [];
    const seen = new Set();
    for (const row of data.results || []) {
      const t = row.taxon || row;
      if (!t || !t.id || !t.name) continue;
      const rank = String(t.rank || "").toLowerCase();
      if (rank && !["species", "subspecies", "variety", "form"].includes(rank)) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const photo =
        (t.default_photo && (t.default_photo.square_url || t.default_photo.url)) || null;
      items.push({
        inatId: Number(t.id),
        scientific: String(t.name).trim(),
        common: String(t.preferred_common_name || "").trim(),
        count: Number(row.count) || 0,
        photo,
        rank: rank || "species",
      });
      if (items.length >= perPage) break;
    }
    return items;
  }

  /**
   * @param {Array<{scientific:string, common?:string, inatId?:number, taxonKey?:number}>} speciesList
   */
  async function relateSpecies(speciesList) {
    const list = (speciesList || []).filter((row) => {
      const sp = row && (row.sp || row);
      return sp && (sp.inatId || sp.scientific || row.inatId || row.scientific);
    });
    if (!list.length) throw new Error("Add at least one species to compare.");

    const withIds = list.filter((row) => {
      const sp = row.sp || row;
      return sp.inatId || row.inatId;
    });
    const unresolved = list
      .filter((row) => {
        const sp = row.sp || row;
        return !(sp.inatId || row.inatId);
      })
      .map((row) => row.sp || row);
    if (!withIds.length) {
      throw new Error("None of the mapped species have an iNaturalist taxon id yet.");
    }

    const taxa = await fetchTaxaByIds(
      withIds.map((row) => (row.sp && row.sp.inatId) || row.inatId)
    );
    const lineages = [];
    const stillUnresolved = unresolved.slice();

    withIds.forEach((spRow) => {
      const sp = spRow.sp || spRow;
      const inatId = sp.inatId || spRow.inatId;
      const taxon = taxa.get(Number(inatId));
      if (!taxon) {
        stillUnresolved.push(sp);
        return;
      }
      const path = ancestryPath(taxon);
      lineages.push({
        sp,
        inatId: Number(taxon.id),
        name: taxon.name,
        common: taxon.preferred_common_name || sp.common || "",
        path,
      });
    });

    if (!lineages.length) {
      throw new Error("Could not load iNaturalist taxonomy for the mapped species.");
    }

    const tree = mergeAncestryTree(lineages);

    return {
      tree,
      lineages,
      unresolved: stillUnresolved,
      source: "iNaturalist",
      tipCount: lineages.length,
    };
  }

  /**
   * Active species (and optionally subspecies) under a higher taxon (e.g. genus).
   * Uses the same taxon_id + rank filter as iNat’s taxonomy browsing.
   */
  async function speciesUnderTaxon(taxonId, { max = 2000 } = {}) {
    const id = Number(taxonId);
    if (!Number.isFinite(id)) return { items: [], total: 0 };
    const items = [];
    const seen = new Set();
    let page = 1;
    let total = Infinity;
    const perPage = 100;
    while (items.length < max && items.length < total) {
      const url = new URL(`${BASE}/taxa`);
      url.searchParams.set("taxon_id", String(id));
      url.searchParams.set("rank", "species");
      url.searchParams.set("is_active", "true");
      url.searchParams.set("order_by", "observations_count");
      url.searchParams.set("order", "desc");
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      const data = await getJson(url.toString());
      total = Number(data.total_results) || 0;
      const batch = data.results || [];
      if (!batch.length) break;
      for (const t of batch) {
        if (!t || !t.id || !t.name) continue;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        items.push({
          inatId: Number(t.id),
          scientific: String(t.name).trim(),
          common: String(t.preferred_common_name || "").trim(),
          rank: String(t.rank || "species").toLowerCase(),
          observations: Number(t.observations_count) || 0,
        });
        if (items.length >= max) break;
      }
      if (page * perPage >= total) break;
      page += 1;
      if (page > 50) break;
    }
    return { items, total: Number.isFinite(total) ? total : items.length };
  }

  return {
    relateSpecies,
    similarSpecies,
    speciesUnderTaxon,
    fetchTaxaByIds,
    tipKey,
  };
})();

window.OPENTREE_API = window.INAT_TAXONOMY;
