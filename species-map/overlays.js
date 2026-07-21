window.OVERLAY_LAYERS = [
  {
    "id": "wc_precip",
    "label": "WorldClim mean annual precip (mm)",
    "file": "overlays/wc_precip.png",
    "bounds": [
      [
        -85.04876511065237,
        -180.0
      ],
      [
        85.05112878,
        179.97260698474233
      ]
    ],
    "units": "mm/year",
    "vmin": 10.0,
    "vmax": 2000.0,
    "period": "1970\u20132000 normals",
    "source_name": "WorldClim 2.1",
    "source_url": "https://www.worldclim.org/",
    "global": true,
    "files": {
      "default": "overlays/wc_precip.png",
      "cb": "overlays/wc_precip_cb.png",
      "hc": "overlays/wc_precip_hc.png"
    }
  },
  {
    "id": "wc_tmean",
    "label": "WorldClim mean annual temp (\u00b0C)",
    "file": "overlays/wc_tmean.png",
    "bounds": [
      [
        -85.04876511065237,
        -180.0
      ],
      [
        85.05112878,
        179.97260698474233
      ]
    ],
    "units": "\u00b0C",
    "vmin": -20.0,
    "vmax": 30.0,
    "period": "1970\u20132000 normals",
    "source_name": "WorldClim 2.1",
    "source_url": "https://www.worldclim.org/",
    "global": true,
    "files": {
      "default": "overlays/wc_tmean.png",
      "cb": "overlays/wc_tmean_cb.png",
      "hc": "overlays/wc_tmean_hc.png"
    }
  }
];
