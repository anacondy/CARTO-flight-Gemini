# Live Flight Radar ✈️🌍

### 🔴 [**View Live Site → anacondy.github.io/CARTO-flight-Gemini**](https://anacondy.github.io/CARTO-flight-Gemini)

A sleek, high-performance, real-time global flight tracker built with **Vanilla JavaScript**, **Leaflet.js**, and the **OpenSky Network API**.

Inspired by high-contrast, dark-mode data visualizations, this radar features a beautiful "Dark Matter" aesthetic with glowing aircraft markers, smooth animations, and dynamic scaling to ensure optimal performance and readability at any zoom level.

---

## 📸 Screenshots

### Desktop View
![Live Flight Radar — Desktop](screenshots/radar-preview.png)

### Mobile View
![Live Flight Radar — Mobile](screenshots/radar-mobile.png)

> **Note:** Screenshots above show the UI shell. On the live site, the CARTO Dark Matter basemap and real aircraft populate the map in real time.

---

## ✨ Features

- **Real-Time Global Tracking:** Fetches live state vectors for thousands of airborne aircraft globally every 15 seconds.
- **Dark Matter Aesthetic:** Utilizes the CARTO Dark Matter basemap for a modern, sleek, and distraction-free experience.
- **Dynamic Zoom Scaling:** Airplane icons dynamically resize based on the camera zoom level. This prevents visual clutter ("whiteouts") when zoomed out to a global view, while maintaining crisp detail when zoomed in.
- **Smart Viewport Rendering:** To ensure a lag-free 60 FPS experience, the map only renders HTML markers for airplanes currently visible within your screen bounds (viewport culling).
- **Smooth CSS Animations:** Planes smoothly glide across the map and rotate to their true headings using hardware-accelerated CSS transitions.
- **Interactive Tooltips & Popups:**
  - Zoom in (level 7+) to reveal permanent text callsigns floating above the aircraft.
  - Click any aircraft to see real-time telemetry: Origin Country, Altitude, Speed (km/h), and Heading.
- **Rate-Limit Handling:** Gracefully handles API congestion with a "Holding Pattern" UI state if the OpenSky API rate limits are temporarily reached.
- **Fully Responsive:** Works seamlessly on all screen sizes — desktop, tablet, and mobile — with safe-area insets for notched devices.
- **High Refresh Rate Ready:** Uses `requestAnimationFrame`-driven rendering and GPU-composited CSS transitions for stutter-free animations at 120 Hz+.
- **Security Hardened:** Content Security Policy, Subresource Integrity (SRI) on all CDN assets, HTML escaping of all API data, and X-Content-Type-Options headers.

---

## 🚀 Tech Stack

This project is incredibly lightweight and requires **zero build tools**.

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| Mapping Engine | [Leaflet.js](https://leafletjs.com/) v1.9.4 |
| Basemap | [CARTO Dark Matter](https://carto.com/basemaps/) |
| Live Data | [OpenSky Network API](https://opensky-network.org/apidoc/) |
| Hosting | GitHub Pages (auto-deployed via GitHub Actions) |

---

## 🛠️ How to Run Locally

Because this project uses entirely client-side, vanilla web technologies without any build steps (like Webpack or Vite), running it is as simple as opening a file.

**1. Clone the repository:**

```bash
git clone https://github.com/anacondy/CARTO-flight-Gemini.git
cd CARTO-flight-Gemini
```

**2. Open the file:**

Simply double-click `index.html` to open it in your default web browser.

*(Alternatively, use an extension like [VSCode Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) for hot-reloading.)*

---

## 📡 API & Data Usage

This project is powered by the [OpenSky Network](https://opensky-network.org/api/states/all), a non-profit association providing open access to actual ADS-B flight tracking data.

### Note on Rate Limits

The OpenSky API allows unauthenticated users to pull data every 10 seconds. This application is configured to poll every **15 seconds** to provide a safety buffer. If you refresh the page frequently, you may encounter an HTTP `429 (Too Many Requests)` error. The app will display a yellow **"Radar congested"** message and will automatically resume tracking once the limit resets.

---

## ⚙️ How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│                                                                 │
│  ┌──────────────┐     fetch every 15s      ┌─────────────────┐ │
│  │  index.html  │ ──────────────────────► │  OpenSky API    │ │
│  │  + Leaflet   │ ◄────────────────────── │  (states/all)   │ │
│  └──────────────┘    JSON: ~8,000 flights  └─────────────────┘ │
│         │                                                       │
│         ▼  renderPlanes()                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Viewport Culling → Only markers in view bounds rendered   │ │
│  │  CSS transitions  → GPU-composited smooth plane movement   │ │
│  │  rAF debounce     → Zero-jank pan/zoom re-renders          │ │
│  └────────────────────────────────────────────────────────────┘ │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────────────┐    ┌───────────────────────────────┐ │
│  │  Leaflet.js Map      │    │  CARTO Dark Matter Tiles      │ │
│  │  (DivIcon markers)   │    │  basemaps.cartocdn.com        │ │
│  └──────────────────────┘    └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

1. **On page load**, `fetchFlightData()` is called immediately and then on a 15-second interval via `setInterval`.
2. The OpenSky API returns a JSON object with a `states` array — each entry is a flight's state vector (position, speed, heading, altitude, callsign, etc.).
3. Flights without a valid lat/lon, or that are on the ground (`state[8] === true`), are filtered out.
4. `renderPlanes()` iterates the filtered list and **creates, updates, or removes** Leaflet `DivIcon` markers:
   - **Create:** If a flight ID is new and within the viewport, a new marker is added.
   - **Update:** If a marker already exists, its `LatLng` is updated (Leaflet animates this via CSS `transform`), and the rotation is updated.
   - **Remove:** Any marker no longer in the dataset or viewport is removed.
5. All popup content from the API is **HTML-escaped** before rendering to prevent XSS.

---

## 🔒 Security

| Measure | Details |
|---|---|
| **Content Security Policy** | `<meta>` CSP restricts all resource origins to only what's needed |
| **Subresource Integrity (SRI)** | SHA-256 integrity hashes on all CDN `<link>` and `<script>` tags |
| **HTML Escaping** | All API data (callsign, country) is escaped before rendering into popups |
| **Referrer Policy** | `strict-origin-when-cross-origin` |
| **Permissions Policy** | Camera, microphone, and geolocation access disabled |
| **No eval / inline data URIs** | All logic is in-line but isolated; no dynamic `eval` usage |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

Feel free to check the [issues page](https://github.com/anacondy/CARTO-flight-Gemini/issues).

---

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

---

*Created with ❤️ by [Anacondy](https://github.com/anacondy) & Gemini*