# City Nights

A local, first-person nighttime observatory above Puget Sound. Starts at **47°48′05.0″N, 122°57′09.7″W** on Quilcene Ridge, **6 ft above terrain**, facing downtown Seattle (approximately **115°**, **31.9 miles** away).

## Run on Windows

Install [Node.js 24 LTS](https://nodejs.org/) if needed. In this directory:

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Alternatively, double-click **Start City Nights.cmd**. An internet connection and a browser with WebGL/hardware acceleration are required. Chrome and Edge are suitable starting points.

The Windows launcher runs `npm install` before starting so platform-specific build dependencies are available even if the directory was previously used from Linux/WSL. Do not run Windows and WSL dependency installs simultaneously.

## Geographic data

The app first tries CesiumJS’s bundled evaluation access. Evaluation access has service limits and can change; it is not a substitute for your own token. Click the data-connection row at the bottom of the observation controls to connect your own public, read-only [Cesium ion token](https://ion.cesium.com/tokens).

Required asset access:

- **Cesium World Terrain**, asset `1`.
- **Cesium OSM Buildings**, asset `96188`.
- **Bing Maps Aerial**, asset `2`, for satellite surface imagery. Terrain relief still works if imagery is unavailable.
- Optional **The Earth at Night**, asset `3812`, for broad surface-light patterns.

Add these assets to your ion account if necessary. Restrict the public token to the intended assets and app URLs. Tokens entered in the app stay in tab-session storage unless you explicitly choose **Remember on this device**. They go directly to Cesium and its data services. You can instead copy `.env.example` to `.env.local` and set `VITE_CESIUM_ION_TOKEN`; restart the dev server after editing it. A Vite environment token is included in the browser bundle, so use a public read-only token, never an account-management credential. Real keys and local environment files are ignored by Git.

If terrain cannot load, the app shows a connection screen rather than presenting a flat globe or invented ridge as the requested view. Terrain/building tile failures remain identified as partial data until reconnect. Distant tile streaming can take time, particularly through a telephoto lens.

## Controls

| Control | Action |
| --- | --- |
| Drag the view | Look around |
| W / A / S / D | Move forward / left / backward / right |
| Q / E | Lower / raise height above terrain |
| Shift | Hold for four times the selected movement speed |
| Mouse wheel or optics dock | Change lens preset |
| Eye level | Restore 6 ft above ground |
| Face Seattle | Aim toward downtown from the current position; keep that reference centered until you drag to look elsewhere |
| Return to ridge | Restore original location, heading, pitch, and 6 ft height; retain selected lens/time |
| Local date & time | Change the sky in Pacific time, automatically using PST/PDT; restore date-based automatic moonlight |
| Moonlight slider / Auto | Override illumination / restore the date-based estimate |
| City brightness | Set city-window emission, optional night imagery, and artificial skyglow from 0% to 300%; star visibility changes with the skyglow |
| Live data & quality | Open the nonmodal status popup, also shown once at startup; keep exploring while it is open |
| Dataset detail boost | Independently select 1×, 2×, or 4× for terrain, buildings, satellite imagery, night imagery, and stars |
| Satellite / Terrain relief | Change surface appearance |

Click or drag the view before using movement keys. Typing in a control does not move the camera. Exploration is limited to 110 km from the starting point. Height ranges from 0.5 ft to 30,000 ft above the terrain. There is no building collision physics.

## What is real, and what is estimated

**Geometry:** Cesium renders a curved WGS84 Earth with streamed terrain and independent OSM building geometry. Terrain and buildings determine occlusion. No tree geometry is added. Satellite textures can still show forests, and the underlying terrain is a mixed-source elevation model, not a locally verified bare-earth LiDAR survey. The default eye height is 1.8288 m above that terrain model. Terrain elevation readouts use Cesium’s source ellipsoid height; they are not a surveyed local sea-level datum.

**Optics:** The naked-eye preset is a 60° horizontal viewing window. Lens presets are rectilinear, 36 mm full-frame equivalents: 24, 35, 50, 85, 135, 200, 400, and 800 mm. Framing magnification is relative to the 60° default. Apparent 1× size depends on the physical screen and viewing distance. Zoom does not add light gathering, a long exposure, or stars beyond the naked-eye visibility model. Horizontal angular framing is preserved when the window changes aspect ratio. Pixel footprints and silhouettes remain limited by display resolution and source geometry.

The initial view and Face Seattle use an aim point in downtown at 200 m ellipsoid height, solely as a framing reference. The sightline uses WGS84 curvature and actual observer height; no building geometry is added or raised at that point. At the default ridge elevation, that direction is approximately 1.1° below the local horizontal, which matters when using telephoto lenses.

**Night lighting:** Building windows use a stable, estimated facade-emission shader on the actual building geometry. Moonlight, regional skyglow, and the display response are estimates, not calibrated photometry. Optional NASA night imagery is treated as a faint lit surface pattern; its emission is not modeled independently of terrain lighting. Building-window emissions do remain independent of moonlight. No claim is made that individual illuminated windows or skyline lighting match a particular real night.

**Sky:** Astronomy Engine calculates the Sun/Moon state and transforms **15,597 real HYG v4.1 stars** from J2000 coordinates to the selected date/location. Stars fade according to magnitude, directional regional light pollution, moonlight, twilight, and a typical dark-adapted observer estimate. Ordinary zoom preserves this sensitivity. Standard celestial refraction and precession/nutation are included; catalog proper motion, weather, eclipses’ dimming, and variable terrestrial refraction are not. Near-horizon sightlines can differ from reality when the atmosphere refracts light.

The Moon retains its dated position and phase when illumination is overridden. Changing the date/time, including the hour shortcuts, clears a manual override and restores Auto before recalculating astronomy and star visibility. A Moon below the horizon supplies no direct illumination, including in manual mode. Selecting daylight produces a daylight sky rather than forcing stars into daylight. Historical dates change astronomical state; terrain, buildings, and imagery retain the available datasets’ vintages. The spring DST gap is rejected; the repeated autumn hour uses its first occurrence.

The city brightness slider scales artificial window emission, regional city skyglow, and optional night-light imagery together. Zero switches those artificial contributions off while leaving natural Moon/twilight illumination alone. The same city multiplier feeds the limiting-magnitude model, so brighter cities hide more faint stars. The displayed star count is the number passing the brightness model before terrain occlusion, not a count of visible points within the current screen.

## Live loading and dataset quality

The prominent status banner and **Data & quality** popup show each dataset’s connection/refinement state, completed tile work, outstanding tile requests, processing jobs, and persistent source warnings. No percentage is invented: moving, changing lenses, or raising quality can introduce new work. A settled view does not mean that the whole region has downloaded. Terrain and imagery share a globe tile queue, shown separately from individual source request counts. Ordinary cancelled obsolete-view requests do not become failures. Source failures remain partial until reconnect; temporary observer-ground resolution failures show a retry state and pause movement.

Each dataset has an independent **1× / 2× / 4× detail boost**. Terrain and building boosts request finer available source levels. Satellite and night imagery refine through Cesium’s shared globe selection. All boosts also increase rendered pixel sampling: at 4×, the requested framebuffer has twice each dimension, subject to hardware limits. Star quality affects rendering only and does not add catalog entries, reveal otherwise invisible stars, change field of view, or improve the astronomical measurements.

This is source refinement and supersampled/interpolated rendering, not generated geography or an upscaled source-file export. Once source detail is exhausted, interpolation can smooth existing data but cannot recover measured terrain or building shapes that are absent. Because the datasets share one view, pixel supersampling applies to the whole frame and imagery refinement shares the terrain queue. The popup reports the actual render dimensions and any active limit. Rendering is capped at twice CSS resolution, 16 million pixels, and the device’s texture/renderbuffer/viewport limits; several boosted datasets do not multiply the sampling cost together. Higher source detail can still take longer to download and use more memory.

**Unlimited visibility** disables terrestrial fog/haze and fog-driven terrain culling. Estimated atmospheric skyglow remains, as required for light pollution. It is an ideal clear-air scenario, not a vacuum.

## Development and verification

```sh
npm test
npm run build
npm run preview
```

`npm test` runs the numeric geography, lens, sky, moonlight, and timezone tests. `npm run build` emits a static app in `dist/`; preview serves that production build on port 4173. Cesium runtime assets are copied from the installed, pinned package by `scripts/sync-cesium.mjs`; the app does not depend on a Cesium JavaScript CDN. The renderer is loaded only in the browser and needs WebGL. Static deployment requires serving `dist/` at a domain root and permitting HTTPS connections to the selected imagery and ion services.

The app uses a frozen simulation clock, renders on demand, and caps active rendering at 30 fps. This reduces idle load; performance still depends on GPU, selected lens, network, and the streamed scene.

Initial version verified on 2026-10-21: 27 numeric tests passed; the production build succeeded; Chromium 153 with software WebGL loaded live terrain/buildings and exercised optics, height, moonlight, date/time, and responsive layout without JavaScript errors. Simulated service rejection opened connection setup correctly. Independent state checks covered slow/stale ground requests, reset retry, retained partial-data warnings, and blocked browser storage. A 60-second telephoto stream check received more than 1,200 successful service responses with no failed requests, while finer distant tiles were still loading. This verifies progressive integration, not every Seattle landmark or physical GPU performance. The Windows launcher was prepared but could not be executed from this Linux session.

Update verification on 2026-10-21: **55/55 tests passed**, and the production build succeeded. Chromium 153 with software WebGL verified date changes restoring Auto, manual moonlight changing the same scene from 2,151 to 900 stars passing the brightness model, city brightness changing another scene from 2,838 to 1,813 stars, all five dataset quality controls, 4× pixel sampling at 2,560 × 1,800 from a 1,280 × 900 view, quality reset, unchanged field of view and star sensitivity during quality changes, mobile layout, and service-failure recovery UI. No JavaScript errors occurred in those production checks. An independent real-Cesium RequestScheduler test confirmed obsolete request cancellation remains healthy rather than creating a false source failure. The build retains the expected warning about the large Cesium engine bundle. These remain software-rendered integration checks, not a physical-device performance measurement.

## Sources and licensing

- [CesiumJS](https://github.com/CesiumGS/cesium), Apache 2.0; data-provider attribution remains visible in the viewport.
- [Astronomy Engine](https://github.com/cosinekitty/astronomy), MIT.
- [HYG v4.1](https://github.com/astronexus/HYG-Database/tree/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg), David Nash / Astronexus, CC BY-SA 4.0. The filtered catalog is an adapted dataset under the same license. See `public/data/STARS-LICENSE.txt` for full attribution and license; `stars.json` embeds the source pin, schema, and filtering details.
- [NASA Black Marble](https://viirsland.gsfc.nasa.gov/Products/NASA/BlackMarble.html), through the optional ion imagery asset. Its roughly 500 m source product cannot resolve individual windows.
- The estimated stellar threshold draws on [Crumey, Human Contrast Threshold and Astronomical Visibility](https://arxiv.org/html/1405.4209v1); regional source strengths are illustrative and have not been calibrated at Quilcene.

The attached Seattle photograph informed lighting character only. It is not used as a backdrop or claimed to show the requested ridge viewpoint.
