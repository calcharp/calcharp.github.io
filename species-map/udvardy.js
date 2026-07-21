/**
 * Udvardy (1975) biogeographical overlays — UNEP-WCMC FeatureServer extract.
 * Realms → biomes → provinces hierarchy.
 */
window.UDVARDY = {
  source_name: "Udvardy Biogeographical Provinces (1975)",
  source_url:
    "https://data-gis.unep-wcmc.org/server/rest/services/Bio-geographicalRegions/Udvardy_Biogeographical_Provinces_1975/FeatureServer",
  citation: "Udvardy, M. D. F. (1975). A classification of the biogeographical provinces of the world. IUCN.",
  layers: [
    {
      id: "realms",
      label: "Realms",
      file: "udvardy/realms.geojson",
      nameProp: "name",
      colors: {
        default: {
          Nearctic: "#3d6f8c",
          Neotropical: "#b85c38",
          Palaearctic: "#4a6b4e",
          Africotropical: "#c9a227",
          Indomalayan: "#7a4e8c",
          Australian: "#2a9d8f",
          Oceanian: "#e76f51",
          Antarctic: "#6c757d",
        },
        cb: {
          Nearctic: "#0072B2",
          Neotropical: "#D55E00",
          Palaearctic: "#009E73",
          Africotropical: "#E69F00",
          Indomalayan: "#CC79A7",
          Australian: "#56B4E9",
          Oceanian: "#F0E442",
          Antarctic: "#000000",
        },
        hc: {
          Nearctic: "#0072B2",
          Neotropical: "#E69F00",
          Palaearctic: "#009E73",
          Africotropical: "#F0E442",
          Indomalayan: "#CC79A7",
          Australian: "#56B4E9",
          Oceanian: "#D55E00",
          Antarctic: "#000000",
        },
      },
    },
    {
      id: "biomes",
      label: "Biomes",
      file: "udvardy/biomes.geojson",
      nameProp: "name",
      colors: {
        default: {
          Tundra: "#8e9aaf",
          Desert: "#c4a574",
          Lakes: "#4a90a4",
          "Mixed mountain": "#6b705c",
          "Temperate grassland": "#a7c957",
          "Temperate and sub-tropical forest and woodland": "#386641",
          "Tropical grassland": "#bc6c25",
          "Tropical dry forests and woodlands": "#9c6644",
          "Tropical forest and woodland": "#2d6a4f",
          "Tropical forest (humid)": "#1b4332",
        },
        cb: {
          Tundra: "#56B4E9",
          Desert: "#E69F00",
          Lakes: "#0072B2",
          "Mixed mountain": "#000000",
          "Temperate grassland": "#F0E442",
          "Temperate and sub-tropical forest and woodland": "#009E73",
          "Tropical grassland": "#D55E00",
          "Tropical dry forests and woodlands": "#CC79A7",
          "Tropical forest and woodland": "#0072B2",
          "Tropical forest (humid)": "#000000",
        },
        hc: {
          Tundra: "#56B4E9",
          Desert: "#F0E442",
          Lakes: "#0072B2",
          "Mixed mountain": "#000000",
          "Temperate grassland": "#E69F00",
          "Temperate and sub-tropical forest and woodland": "#009E73",
          "Tropical grassland": "#D55E00",
          "Tropical dry forests and woodlands": "#CC79A7",
          "Tropical forest and woodland": "#56B4E9",
          "Tropical forest (humid)": "#000000",
        },
      },
    },
    {
      id: "provinces",
      label: "Provinces",
      file: "udvardy/provinces.geojson",
      nameProp: "provname",
      // Provinces use a cycling palette keyed by name hash
      palette: {
        default: ["#3d6f8c", "#b85c38", "#4a6b4e", "#c9a227", "#7a4e8c", "#2a9d8f", "#e76f51", "#6c757d", "#9c6644", "#457b9d"],
        cb: ["#0072B2", "#D55E00", "#009E73", "#E69F00", "#CC79A7", "#56B4E9", "#F0E442", "#000000"],
        hc: ["#0072B2", "#E69F00", "#009E73", "#F0E442", "#CC79A7", "#56B4E9", "#D55E00", "#000000"],
      },
    },
  ],
};
