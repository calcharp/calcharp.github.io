/**
 * Global elevation overlay from AWS Terrain Tiles (Mapzen Terrarium encoding).
 * Decodes meters from RGB, paints a hypsometric ramp + light hillshade.
 * https://registry.opendata.aws/terrain-tiles/
 */
window.ELEVATION_TILES = (() => {
  const TILE_URL =
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

  // Land stops in meters → RGB (oceans stay transparent over the basemap)
  const RAMPS = {
    default: [
      [0, [70, 120, 70]],
      [400, [120, 150, 80]],
      [900, [160, 170, 100]],
      [1600, [170, 140, 100]],
      [2500, [170, 150, 130]],
      [3500, [190, 190, 190]],
      [5000, [245, 245, 245]],
    ],
    cb: [
      [0, [0, 34, 78]],
      [400, [70, 91, 122]],
      [900, [110, 127, 109]],
      [1600, [166, 148, 80]],
      [2500, [200, 180, 100]],
      [3500, [230, 210, 130]],
      [5000, [255, 230, 150]],
    ],
    hc: [
      [0, [20, 10, 50]],
      [400, [80, 40, 120]],
      [900, [180, 80, 40]],
      [1600, [230, 160, 20]],
      [2500, [240, 200, 60]],
      [3500, [255, 240, 80]],
      [5000, [255, 255, 200]],
    ],
  };

  function decodeTerrarium(r, g, b) {
    return r * 256 + g + b / 256 - 32768;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function colorForElev(m, theme) {
    const stops = RAMPS[theme] || RAMPS.default;
    if (m < 0) return null; // ocean / lake → leave transparent
    if (m <= stops[0][0]) return stops[0][1].slice();
    for (let i = 1; i < stops.length; i++) {
      const [e0, c0] = stops[i - 1];
      const [e1, c1] = stops[i];
      if (m <= e1) {
        const t = (m - e0) / (e1 - e0 || 1);
        return [
          Math.round(lerp(c0[0], c1[0], t)),
          Math.round(lerp(c0[1], c1[1], t)),
          Math.round(lerp(c0[2], c1[2], t)),
        ];
      }
    }
    return stops[stops.length - 1][1].slice();
  }

  function createLayer(opts = {}) {
    const ElevLayer = L.GridLayer.extend({
      options: {
        tileSize: 256,
        minZoom: 0,
        maxZoom: 15,
        maxNativeZoom: 15,
        opacity: 0.7,
        theme: "default",
        attribution:
          'Elevation <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (Mapzen Terrarium)',
      },

      createTile(coords, done) {
        const size = this.getTileSize();
        const canvas = document.createElement("canvas");
        canvas.width = size.x;
        canvas.height = size.y;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const theme = this.options.theme || "default";

        const url = L.Util.template(TILE_URL, {
          z: coords.z,
          x: coords.x,
          y: coords.y,
        });

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, size.x, size.y);
            const imageData = ctx.getImageData(0, 0, size.x, size.y);
            const data = imageData.data;
            const w = size.x;
            const h = size.y;
            const elev = new Float32Array(w * h);

            for (let i = 0, p = 0; i < data.length; i += 4, p++) {
              elev[p] = decodeTerrarium(data[i], data[i + 1], data[i + 2]);
            }

            // Approximate meters per pixel (Web Mercator) for hillshade
            const n =
              Math.PI - (2 * Math.PI * (coords.y + 0.5)) / Math.pow(2, coords.z);
            const lat =
              (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
            const mPerPx =
              (156543.03392 * Math.cos((lat * Math.PI) / 180)) /
              Math.pow(2, coords.z);

            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const p = y * w + x;
                const z = elev[p];
                const i = p * 4;
                const rgb = colorForElev(z, theme);
                if (!rgb) {
                  data[i] = data[i + 1] = data[i + 2] = 0;
                  data[i + 3] = 0;
                  continue;
                }

                const zl = elev[y * w + Math.max(0, x - 1)];
                const zr = elev[y * w + Math.min(w - 1, x + 1)];
                const zt = elev[Math.max(0, y - 1) * w + x];
                const zb = elev[Math.min(h - 1, y + 1) * w + x];
                const dzdx = (zr - zl) / (2 * Math.max(mPerPx, 1));
                const dzdy = (zb - zt) / (2 * Math.max(mPerPx, 1));
                const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
                const aspect = Math.atan2(dzdy, -dzdx);
                const zenith = (45 * Math.PI) / 180;
                const azimuth = (315 * Math.PI) / 180;
                let shade =
                  Math.cos(zenith) * Math.cos(slope) +
                  Math.sin(zenith) *
                    Math.sin(slope) *
                    Math.cos(azimuth - aspect);
                shade = 0.55 + 0.45 * Math.max(0, Math.min(1, shade));

                data[i] = Math.min(255, Math.round(rgb[0] * shade));
                data[i + 1] = Math.min(255, Math.round(rgb[1] * shade));
                data[i + 2] = Math.min(255, Math.round(rgb[2] * shade));
                data[i + 3] = 230;
              }
            }

            ctx.putImageData(imageData, 0, 0);
            done(null, canvas);
          } catch (err) {
            done(err, canvas);
          }
        };
        img.onerror = () => done(new Error("Elevation tile failed"), canvas);
        img.src = url;
        return canvas;
      },

      setTheme(theme) {
        this.options.theme = theme;
        this.redraw();
      },
    });

    return new ElevLayer(opts);
  }

  return {
    createLayer,
    legend: {
      vmin: 0,
      vmax: 5000,
      units: "m",
      source_name: "AWS Terrain Tiles (Mapzen Terrarium)",
      source_url: "https://registry.opendata.aws/terrain-tiles/",
    },
  };
})();
