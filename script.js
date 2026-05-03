(() => {
  "use strict";

  const APP_VERSION = "1.6.0";

  const CAMERA_PACKS = {
    bay: {
      label: "Bay / SF / Tracy / Los Banos",
      url: "./cameras.json"
    },
    california: {
      label: "California",
      url: "./packs/cameras-california.json"
    }
  };

  const DEFAULT_CENTER = [37.3348, -121.8881];
  const DEFAULT_ZOOM = 10;
  const MAX_RENDERED_MARKERS = 1600;
  const NEARBY_FEET = 650;

  const state = {
    currentView: "dashboard",
    cameras: [],
    renderedMarkers: new Map(),
    map: null,
    cameraLayer: null,
    userMarker: null,
    accuracyCircle: null,
    watchId: null,
    followUser: false,
    pendingRecenter: false,
    lastPosition: null,
    currentAreaLabel: "GPS waiting...",
    viewAreaLabel: "Map view",
    lastReverseLookupAt: 0,
    lastReverseLookupPoint: null,
    reverseLookupInFlight: false,
    nearestCamera: null,
    activePack: localStorage.getItem("proxysniff_pack") || "bay",
    renderRange: localStorage.getItem("proxysniff_render_range") || "auto",
    scanRunning: false,
    fakeFeedEnabled: true,
    bleInterval: null,
    demoInterval: null,
    bleLines: [],
    miniLines: [],
    wifiRows: [],
    bleTotal: 0,
    wifiTotal: 0,
    mapReady: false,
    mapFullscreen: false,
    safeMode: localStorage.getItem("proxysniff_safe_mode") !== "off",
    opsLines: [],
    opsProgressTimer: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    splash: $("#splashScreen"),
    app: $("#appShell"),
    runtimeLabel: $("#runtimeLabel"),
    menuBtn: $("#menuBtn"),
    quickMenu: $("#quickMenu"),
    bleCount: $("#bleCount"),
    wifiCount: $("#wifiCount"),
    cameraCount: $("#cameraCount"),
    nearestCard: $("#nearestCard"),
    packLabel: $("#packLabel"),
    brandBars: $("#brandBars"),
    miniTerminal: $("#miniTerminal"),
    scanState: $("#scanState"),
    bleTerminal: $("#bleTerminal"),
    wifiList: $("#wifiList"),
    startScanBtn: $("#startScanBtn"),
    stopScanBtn: $("#stopScanBtn"),
    burstBtn: $("#burstBtn"),
    locateBtn: $("#locateBtn"),
    recenterBtn: $("#recenterBtn"),
    fullscreenMapBtn: $("#fullscreenMapBtn"),
    demoDriveBtn: $("#demoDriveBtn"),
    fitCamsBtn: $("#fitCamsBtn"),
    coordsChip: $("#coordsChip"),
    areaChip: $("#areaChip"),
    flockChip: $("#flockChip"),
    visibleChip: $("#visibleChip"),
    followChip: $("#followChip"),
    addressForm: $("#addressForm"),
    addressInput: $("#addressInput"),
    packSelect: $("#packSelect"),
    renderRangeSelect: $("#renderRangeSelect"),
    fakeFeedToggle: $("#fakeFeedToggle"),
    reloadDataBtn: $("#reloadDataBtn"),
    clearCacheBtn: $("#clearCacheBtn"),
    safeModeBtn: $("#safeModeBtn"),
    hudBtn: $("#hudBtn"),
    opsPanel: $("#opsPanel"),
    opsTargets: $("#opsTargets"),
    opsTerminal: $("#opsTerminal"),
    opsProgress: $("#opsProgress")
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    wireEvents();
    setSafeMode(state.safeMode, false);
    seedWifi();
    renderWifiList();
    startScanner();
    await loadCameraPack(state.activePack);
    setTimeout(() => {
      els.splash.classList.add("done");
      els.app.classList.remove("is-hidden");
      setTimeout(() => (els.splash.style.display = "none"), 650);
    }, 900);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./service-worker.js?v=1.6.0").catch(() => {});
    }
  }

  function wireEvents() {
    $$('[data-nav]').forEach((btn) => btn.addEventListener("click", () => navigate(btn.dataset.nav)));
    els.menuBtn.addEventListener("click", () => {
      els.quickMenu.hidden = !els.quickMenu.hidden;
    });
    els.startScanBtn.addEventListener("click", startScanner);
    els.stopScanBtn.addEventListener("click", stopScanner);
    els.burstBtn.addEventListener("click", () => burstSignals(8));
    els.locateBtn.addEventListener("click", toggleFollowTracking);
    els.recenterBtn.addEventListener("click", recenterOnUser);
    els.fullscreenMapBtn.addEventListener("click", toggleMapFullscreen);
    els.fitCamsBtn.addEventListener("click", fitCameraBounds);
    els.demoDriveBtn.addEventListener("click", toggleDemoDrive);
    els.addressForm.addEventListener("submit", searchAddress);
    els.packSelect.value = state.activePack;
    els.renderRangeSelect.value = state.renderRange;
    els.packSelect.addEventListener("change", async (event) => {
      const pack = event.target.value;
      localStorage.setItem("proxysniff_pack", pack);
      await loadCameraPack(pack);
    });
    els.renderRangeSelect.addEventListener("change", (event) => {
      state.renderRange = event.target.value;
      localStorage.setItem("proxysniff_render_range", state.renderRange);
      renderVisibleCameras();
    });
    els.fakeFeedToggle.addEventListener("change", (event) => {
      state.fakeFeedEnabled = event.target.checked;
      if (state.fakeFeedEnabled) startScanner(); else stopScanner();
    });
    els.reloadDataBtn?.addEventListener("click", () => loadCameraPack(state.activePack, true));
    els.clearCacheBtn?.addEventListener("click", clearAppCache);
    els.safeModeBtn.addEventListener("click", () => {
      setSafeMode(!state.safeMode);
    });
    $$(".op-btn").forEach((btn) => btn.addEventListener("click", () => runVisualOp(btn.dataset.op || btn.textContent.trim())));
    els.hudBtn.addEventListener("click", () => {
      document.body.classList.toggle("no-scanlines");
      $(".scanlines").style.display = document.body.classList.contains("no-scanlines") ? "none" : "block";
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopScanner(false);
      else if (state.fakeFeedEnabled) startScanner(false);
    });
  }

  function navigate(view) {
    state.currentView = view;
    els.quickMenu.hidden = true;
    $$(".view").forEach((el) => el.classList.remove("active"));
    const target = $(`#view-${view}`);
    if (target) target.classList.add("active");
    $$(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.nav === view));

    if (view === "map") {
      initMapOnce();
      setTimeout(() => {
        state.map?.invalidateSize();
        renderVisibleCameras();
      }, 150);
      setTimeout(() => {
        state.map?.invalidateSize();
        renderVisibleCameras();
      }, 650);
    }
  }

  async function loadCameraPack(packKey, forceReload = false) {
    const pack = CAMERA_PACKS[packKey] || CAMERA_PACKS.bay;
    state.activePack = packKey;
    els.runtimeLabel.textContent = `loading ${pack.label}`;
    setAreaChip(`loading ${pack.label}...`);

    try {
      const raw = await fetchCameraJson(pack.url, forceReload);
      state.cameras = normalizeCameraData(raw);

      if (!state.cameras.length) {
        throw new Error("Camera dataset loaded but had no valid lat/lng points");
      }

      state.renderedMarkers.clear();
      if (state.cameraLayer) state.cameraLayer.clearLayers();
      els.packLabel.textContent = pack.label;
      els.cameraCount.textContent = formatNumber(state.cameras.length);
      refreshAreaChip();
      els.runtimeLabel.textContent = `${formatNumber(state.cameras.length)} points ready`;
      renderBrandBars();
      renderVisibleCameras();
      updateNearestCamera();
    } catch (error) {
      console.error("Primary camera pack failed:", error);

      if (pack.url !== "./cameras.json") {
        try {
          els.runtimeLabel.textContent = "loading fallback pack";
          setAreaChip("loading fallback camera pack...");
          const raw = await fetchCameraJson("./cameras.json", true);
          state.cameras = normalizeCameraData(raw);
          if (!state.cameras.length) throw new Error("Fallback pack had no valid points");
          state.renderedMarkers.clear();
          if (state.cameraLayer) state.cameraLayer.clearLayers();
          els.packLabel.textContent = CAMERA_PACKS.bay.label;
          els.cameraCount.textContent = formatNumber(state.cameras.length);
          refreshAreaChip();
          els.runtimeLabel.textContent = `${formatNumber(state.cameras.length)} points ready`;
          renderBrandBars();
          renderVisibleCameras();
          updateNearestCamera();
          return;
        } catch (fallbackError) {
          console.error("Fallback camera pack failed:", fallbackError);
        }
      }

      setAreaChip("camera pack failed to load");
      els.runtimeLabel.textContent = "dataset error";
      els.visibleChip.textContent = "0 cameras rendered";
    }
  }

  async function fetchCameraJson(url, forceReload = false) {
    const versionToken = forceReload ? `${APP_VERSION}-${Date.now()}` : APP_VERSION;
    const requestUrl = `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(versionToken)}`;
    const response = await fetch(requestUrl, {
      cache: forceReload ? "reload" : "no-cache",
      credentials: "same-origin",
      headers: { "Accept": "application/json, application/geo+json, text/plain;q=0.9" }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error(`${url} was empty`);
    if (trimmed.startsWith("<")) throw new Error(`${url} returned HTML instead of JSON. Check your server root/path.`);
    return JSON.parse(trimmed);
  }

  function normalizeCameraData(raw) {
    if (raw?.type === "FeatureCollection" && Array.isArray(raw.features)) {
      return raw.features.map((feature, index) => {
        const props = feature.properties || {};
        const coords = feature.geometry?.coordinates || [];
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        return cleanCamera({
          id: props.osmId || props.id || index,
          osmType: props.osmType || "node",
          name: props.name || `${props.brand || props.operator || "ALPR"} Camera ${props.osmId || index}`,
          type: props.type || props.surveillanceType || "ALPR Camera",
          brand: props.brand || props.manufacturer || props.operator || "Unknown",
          operator: props.operator,
          lat, lng,
          direction: props.direction,
          mount: props.mountType || props.mount,
          zone: props.surveillanceZone || props.zone,
          osmTimestamp: props.osmTimestamp,
          source: "GeoJSON"
        });
      }).filter(Boolean);
    }

    if (Array.isArray(raw)) {
      return raw.map(cleanCamera).filter(Boolean);
    }

    return [];
  }

  function cleanCamera(item) {
    const lat = Number(item.lat);
    const lng = Number(item.lng ?? item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      id: String(item.id ?? item.osmId ?? `${lat},${lng}`),
      osmType: item.osmType || "node",
      name: item.name || `${item.brand || "ALPR"} Camera`,
      type: item.type || "ALPR Camera",
      brand: item.brand || item.operator || "Unknown",
      operator: item.operator || "",
      lat,
      lng,
      direction: item.direction === undefined ? null : Number(item.direction),
      mount: item.mount || item.mountType || "unknown",
      zone: item.zone || item.surveillanceZone || "unknown",
      osmTimestamp: item.osmTimestamp || "",
      source: item.source || "Local dataset"
    };
  }

  function initMapOnce() {
    if (state.mapReady) return;
    if (!window.L) {
      setAreaChip("map engine failed to load");
      els.runtimeLabel.textContent = "Leaflet missing";
      return;
    }
    state.mapReady = true;
    state.map = L.map("map", {
      zoomControl: false,
      preferCanvas: true,
      minZoom: 4,
      maxZoom: 20
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20
    }).addTo(state.map);

    L.control.zoom({ position: "bottomright" }).addTo(state.map);
    state.cameraLayer = L.layerGroup().addTo(state.map);
    state.map.on("moveend zoomend", renderVisibleCameras);
    state.map.on("dragstart", () => {
      if (state.followUser) setFollowMode(false);
    });
    renderVisibleCameras();
  }

  function renderVisibleCameras() {
    if (!state.mapReady || !state.map || !state.cameraLayer || !state.cameras.length) return;
    const bounds = getExpandedBounds();
    const zoom = state.map.getZoom();
    const candidates = [];

    for (const cam of state.cameras) {
      if (bounds.contains([cam.lat, cam.lng])) candidates.push(cam);
    }

    candidates.sort((a, b) => brandPriority(a) - brandPriority(b));
    const visible = candidates.slice(0, MAX_RENDERED_MARKERS);
    const visibleIds = new Set(visible.map((cam) => cam.id));

    for (const [id, marker] of state.renderedMarkers.entries()) {
      if (!visibleIds.has(id)) {
        state.cameraLayer.removeLayer(marker);
        state.renderedMarkers.delete(id);
      }
    }

    for (const cam of visible) {
      if (state.renderedMarkers.has(cam.id)) continue;
      const marker = L.circleMarker([cam.lat, cam.lng], cameraMarkerStyle(cam, zoom));
      marker.bindPopup(createCameraPopup(cam));
      marker.on("click", () => {
        state.nearestCamera = cam;
        updateFlockChip(cam, state.lastPosition ? distanceFeet(state.lastPosition.lat, state.lastPosition.lng, cam.lat, cam.lng) : null);
      });
      marker.addTo(state.cameraLayer);
      state.renderedMarkers.set(cam.id, marker);
    }

    els.visibleChip.textContent = `${formatNumber(state.renderedMarkers.size)} cameras rendered`;
  }

  function getExpandedBounds() {
    const bounds = state.map.getBounds();
    const mode = state.renderRange;
    let pad = 0.18;
    if (mode === "near") pad = 0.05;
    if (mode === "wide") pad = 0.42;
    if (mode === "auto") pad = state.map.getZoom() < 10 ? 0.1 : 0.24;
    return bounds.pad(pad);
  }

  function brandPriority(cam) {
    if ((cam.brand || "").toLowerCase().includes("flock")) return 0;
    if ((cam.type || "").toLowerCase().includes("alpr")) return 1;
    return 2;
  }

  function cameraMarkerStyle(cam, zoom) {
    const isFlock = (cam.brand || "").toLowerCase().includes("flock");
    const isMotorola = (cam.brand || "").toLowerCase().includes("motorola");
    const radius = zoom < 9 ? 4 : zoom < 12 ? 6 : 8;
    return {
      className: "camera-marker",
      radius,
      color: isFlock ? "#18a8ff" : isMotorola ? "#8f7bff" : "#70c7ff",
      weight: 2,
      opacity: 0.95,
      fillColor: isFlock ? "#0aa2ff" : isMotorola ? "#8f7bff" : "#80d8ff",
      fillOpacity: isFlock ? 0.42 : 0.3
    };
  }

  function createCameraPopup(cam) {
    const distance = state.lastPosition ? formatDistance(distanceFeet(state.lastPosition.lat, state.lastPosition.lng, cam.lat, cam.lng)) : "GPS waiting";
    const osmType = cam.osmType || "node";
    const osmUrl = `https://www.openstreetmap.org/${osmType}/${encodeURIComponent(cam.id)}`;
    const coords = `${cam.lat.toFixed(6)}, ${cam.lng.toFixed(6)}`;
    return `
      <div class="popup-card">
        <h3>${escapeHtml(cam.type || "ALPR Camera")}</h3>
        <div class="popup-grid">
          <span>ID</span><span>${escapeHtml(cam.id)}</span>
          <span>Brand</span><span>${escapeHtml(cam.brand || "Unknown")}</span>
          <span>Operator</span><span>${escapeHtml(cam.operator || "--")}</span>
          <span>Zone</span><span>${escapeHtml(cam.zone || "--")}</span>
          <span>Mount</span><span>${escapeHtml(cam.mount || "--")}</span>
          <span>Direction</span><span>${cam.direction ?? "--"}</span>
          <span>Distance</span><span>${distance}</span>
          <span>Coords</span><span>${coords}</span>
        </div>
        <a target="_blank" rel="noopener" href="${osmUrl}">View OSM</a>
      </div>`;
  }

  function setFollowMode(enabled, label = "on") {
    state.followUser = enabled;
    els.locateBtn.classList.toggle("following", enabled);
    els.locateBtn.textContent = enabled ? "Following" : "Follow Me";
    els.locateBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
    els.followChip.textContent = enabled ? `follow: ${label}` : "follow: off";
    refreshAreaChip();
  }

  function ensureLocationWatch() {
    initMapOnce();

    if (!navigator.geolocation) {
      setFollowMode(false);
      els.flockChip.textContent = "GPS unavailable";
      els.followChip.textContent = "follow: GPS unavailable";
      return false;
    }

    if (state.watchId !== null) return true;

    state.watchId = navigator.geolocation.watchPosition(onLocation, onLocationError, {
      enableHighAccuracy: true,
      maximumAge: 2500,
      timeout: 12000
    });

    return true;
  }

  function toggleFollowTracking() {
    initMapOnce();

    if (state.followUser) {
      setFollowMode(false);
      return;
    }

    if (!ensureLocationWatch()) return;
    setFollowMode(true);

    if (state.lastPosition && state.map) {
      state.map.setView([state.lastPosition.lat, state.lastPosition.lng], Math.max(15, state.map.getZoom()), { animate: true });
    }
  }

  function startLocationTracking() {
    if (!ensureLocationWatch()) return;
    setFollowMode(true);
  }

  function onLocation(position) {
    const { latitude, longitude, accuracy, heading } = position.coords;
    state.lastPosition = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy || 0,
      heading: Number.isFinite(heading) ? heading : null,
      timestamp: Date.now()
    };

    els.coordsChip.textContent = `LAT ${latitude.toFixed(5)} / LNG ${longitude.toFixed(5)}`;
    updateCurrentAreaLabel(latitude, longitude);
    updateUserMarker();
    updateNearestCamera();
    if (state.pendingRecenter && state.map) {
      state.pendingRecenter = false;
      state.map.setView([latitude, longitude], Math.max(15, state.map.getZoom()), { animate: true });
    } else if (state.followUser && state.map) {
      const targetZoom = Math.max(state.map.getZoom(), 15);
      state.map.setView([latitude, longitude], targetZoom, { animate: true });
    }
  }

  function setAreaChip(text) {
    els.areaChip.textContent = text;
  }

  function refreshAreaChip() {
    // HUD rule:
    // - Follow/Driving mode = show the user's live GPS area.
    // - Search/browsing mode = show the last searched/viewed place.
    // - Never use this chip for dataset counts; camera counts stay in their own chips/cards.
    if (state.followUser) {
      if (state.currentAreaLabel && state.currentAreaLabel !== "GPS waiting...") {
        setAreaChip(state.currentAreaLabel);
      } else if (state.lastPosition) {
        setAreaChip("locating current area...");
      } else {
        setAreaChip("GPS waiting...");
      }
      return;
    }

    if (state.viewAreaLabel && state.viewAreaLabel !== "Map view") {
      setAreaChip(state.viewAreaLabel);
      return;
    }

    setAreaChip("Search a place or tap Follow Me");
  }

  function updateCurrentAreaLabel(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const now = Date.now();
    const lastPoint = state.lastReverseLookupPoint;
    const movedFeet = lastPoint ? distanceFeet(lat, lng, lastPoint.lat, lastPoint.lng) : Infinity;
    const shouldReverseLookup = !state.currentAreaLabel || state.currentAreaLabel === "GPS waiting..." || movedFeet > 350 || now - state.lastReverseLookupAt > 45000;

    refreshAreaChip();

    if (!shouldReverseLookup || state.reverseLookupInFlight) return;
    reverseGeocodeCurrentLocation(lat, lng);
  }

  async function reverseGeocodeCurrentLocation(lat, lng) {
    state.reverseLookupInFlight = true;
    state.lastReverseLookupAt = Date.now();
    state.lastReverseLookupPoint = { lat, lng };

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) throw new Error(`Reverse geocode HTTP ${response.status}`);
      const result = await response.json();
      const label = formatReverseAddress(result);

      if (state.lastPosition && distanceFeet(state.lastPosition.lat, state.lastPosition.lng, lat, lng) < 900) {
        state.currentAreaLabel = label || `Near ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        refreshAreaChip();
      }
    } catch (error) {
      console.warn("Reverse geocode failed:", error);
      state.currentAreaLabel = `Near ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      refreshAreaChip();
    } finally {
      state.reverseLookupInFlight = false;
    }
  }

  function formatReverseAddress(result) {
    const address = result?.address || {};
    const road = address.road || address.pedestrian || address.footway || address.cycleway || address.path;
    const house = address.house_number;
    const place = address.mall || address.amenity || address.shop || address.building || address.neighbourhood || address.suburb;
    const city = address.city || address.town || address.village || address.hamlet || address.county;

    if (road && city) return `${house ? `${house} ` : ""}${road}, ${city}`;
    if (place && city) return `${place}, ${city}`;
    if (road) return `${house ? `${house} ` : ""}${road}`;
    if (city) return city;
    if (result?.display_name) return result.display_name.split(",").slice(0, 3).join(",").trim();
    return "Current location";
  }

  function onLocationError(error) {
    console.warn(error);
    state.pendingRecenter = false;
    setFollowMode(false);
    els.followChip.textContent = "follow: GPS blocked";
    els.flockChip.textContent = "Flock ~ GPS permission needed";
  }

  function updateUserMarker() {
    if (!state.mapReady || !state.map || !state.lastPosition) return;
    const latlng = [state.lastPosition.lat, state.lastPosition.lng];
    if (!state.userMarker) {
      state.userMarker = L.circleMarker(latlng, {
        className: "user-marker",
        radius: 9,
        color: "#fff",
        weight: 2,
        fillColor: "#ff4258",
        fillOpacity: 0.88
      }).addTo(state.map).bindPopup("You are here");
    } else {
      state.userMarker.setLatLng(latlng);
    }

    if (!state.accuracyCircle) {
      state.accuracyCircle = L.circle(latlng, {
        radius: state.lastPosition.accuracy || 35,
        color: "#ff5a6f",
        weight: 1,
        opacity: 0.25,
        fillColor: "#ff5a6f",
        fillOpacity: 0.07
      }).addTo(state.map);
    } else {
      state.accuracyCircle.setLatLng(latlng).setRadius(state.lastPosition.accuracy || 35);
    }
  }

  function updateNearestCamera() {
    if (!state.cameras.length) return;
    const origin = state.lastPosition || { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
    let best = null;
    let bestFeet = Infinity;

    for (const cam of state.cameras) {
      const ft = distanceFeet(origin.lat, origin.lng, cam.lat, cam.lng);
      if (ft < bestFeet) {
        best = cam;
        bestFeet = ft;
      }
    }

    state.nearestCamera = best;
    updateFlockChip(best, bestFeet);
  }

  function updateFlockChip(cam, feet) {
    if (!cam) {
      els.flockChip.textContent = "Flock ~ scanning...";
      els.nearestCard.textContent = "--";
      return;
    }
    const brand = (cam.brand || "ALPR").includes("Flock") ? "Flock" : "ALPR";
    const distanceText = feet === null ? "tap detected" : formatDistance(feet);
    els.flockChip.textContent = feet !== null && feet <= NEARBY_FEET ? `${brand} ~ nearby (${distanceText})` : `${brand} ~ ${distanceText}`;
    els.nearestCard.textContent = distanceText;
  }

  function toggleMapFullscreen() {
    state.mapFullscreen = !state.mapFullscreen;
    document.body.classList.toggle("map-fullscreen", state.mapFullscreen);
    els.fullscreenMapBtn.textContent = state.mapFullscreen ? "×" : "⛶";
    els.fullscreenMapBtn.setAttribute("aria-label", state.mapFullscreen ? "Exit fullscreen map" : "Toggle fullscreen map");
    setTimeout(() => {
      state.map?.invalidateSize();
      renderVisibleCameras();
    }, 80);
    setTimeout(() => {
      state.map?.invalidateSize();
      renderVisibleCameras();
    }, 360);
  }

  async function clearAppCache() {
    els.runtimeLabel.textContent = "clearing cache";
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      localStorage.removeItem("proxysniff_pack");
      els.runtimeLabel.textContent = "cache cleared";
      setAreaChip("cache cleared — reloading...");
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      console.warn(error);
      els.runtimeLabel.textContent = "cache clear failed";
    }
  }

  function recenterOnUser() {
    initMapOnce();
    if (state.lastPosition && state.map) {
      state.map.setView([state.lastPosition.lat, state.lastPosition.lng], Math.max(15, state.map.getZoom()), { animate: true });
      return;
    }

    state.pendingRecenter = true;
    if (ensureLocationWatch()) {
      els.followChip.textContent = state.followUser ? "follow: on" : "follow: recentering";
    }
  }

  function fitCameraBounds() {
    initMapOnce();
    setFollowMode(false);
    if (!state.map || !state.cameras.length) return;
    const points = state.cameras.slice(0, 2500).map((cam) => [cam.lat, cam.lng]);
    state.map.fitBounds(points, { padding: [24, 24], maxZoom: 10 });
  }

  function toggleDemoDrive() {
    initMapOnce();
    if (state.demoInterval) {
      clearInterval(state.demoInterval);
      state.demoInterval = null;
      els.demoDriveBtn.textContent = "Demo Drive";
      setFollowMode(false);
      return;
    }

    const route = [
      [37.24302, -121.89170],
      [37.24352, -121.89040],
      [37.24397, -121.88897],
      [37.24448, -121.88720],
      [37.24502, -121.88592],
      [37.24605, -121.88380]
    ];
    let i = 0;
    setFollowMode(true, "demo");
    els.demoDriveBtn.textContent = "Stop Demo";

    const step = () => {
      const [lat, lng] = route[i % route.length];
      onLocation({ coords: { latitude: lat, longitude: lng, accuracy: 12, heading: 0 } });
      i += 1;
    };
    step();
    state.demoInterval = setInterval(step, 1700);
  }

  async function searchAddress(event) {
    event.preventDefault();
    const query = els.addressInput.value.trim();
    if (!query) return;
    initMapOnce();
    setFollowMode(false);
    els.runtimeLabel.textContent = "searching map";
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      const results = await response.json();
      if (!results.length) {
        els.runtimeLabel.textContent = "no map result found";
        return;
      }
      const result = results[0];
      const lat = Number(result.lat);
      const lng = Number(result.lon);
      state.map.setView([lat, lng], 15, { animate: true });
      const searchLabel = result.display_name.split(",").slice(0, 3).join(",").trim();
      state.viewAreaLabel = searchLabel || query;
      els.runtimeLabel.textContent = `viewing ${result.display_name.split(",").slice(0, 2).join(",").trim()}`;
      refreshAreaChip();
    } catch (error) {
      console.warn(error);
      els.runtimeLabel.textContent = "address search failed";
    }
  }

  function renderBrandBars() {
    const counts = new Map();
    for (const cam of state.cameras) {
      const brand = cam.brand || "Unknown";
      counts.set(brand, (counts.get(brand) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = Math.max(...top.map(([, count]) => count), 1);
    els.brandBars.innerHTML = top.map(([brand, count]) => `
      <div class="brand-row">
        <div class="brand-label"><strong>${escapeHtml(brand)}</strong><span>${formatNumber(count)}</span></div>
        <div class="brand-track"><div class="brand-fill" style="width:${Math.max(4, (count / max) * 100)}%"></div></div>
      </div>
    `).join("");
  }

  function startScanner(updateText = true) {
    if (!state.fakeFeedEnabled) return;
    state.scanRunning = true;
    if (updateText) els.scanState.textContent = "scanning";
    if (state.bleInterval) return;
    burstSignals(12);
    state.bleInterval = setInterval(() => addBleLine(), 950);
  }

  function stopScanner(updateText = true) {
    state.scanRunning = false;
    if (updateText) els.scanState.textContent = "standby";
    if (state.bleInterval) {
      clearInterval(state.bleInterval);
      state.bleInterval = null;
    }
  }

  function burstSignals(amount = 5) {
    for (let i = 0; i < amount; i += 1) addBleLine();
  }

  function addBleLine() {
    const now = new Date();
    const line = {
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      name: randomChoice([
        "FS Ext Battery",
        "FlockCam-BLE",
        "ALPR Node",
        "Roadside Sensor",
        "BASEnewZ",
        "iBeacon",
        "Tile Tracker",
        "Vehicle BLE",
        "[unknown]",
        "TrafficBox"
      ]),
      mac: randomMac(),
      payload: randomPayload(12 + randInt(0, 8)),
      signal: randInt(-92, -39)
    };
    state.bleLines.unshift(line);
    state.miniLines.unshift(line);
    state.bleLines = state.bleLines.slice(0, 80);
    state.miniLines = state.miniLines.slice(0, 9);
    state.bleTotal += 1;
    if (Math.random() > 0.68) {
      state.wifiTotal += 1;
      mutateWifi();
      renderWifiList();
    }
    renderTerminals();
    updateCounters();
  }

  function renderTerminals() {
    const render = (line) => `
      <div class="term-line">
        <b>ADV</b>
        <span class="name">${escapeHtml(line.name)} • ${line.mac} • ${line.payload}</span>
        <span class="sig">${line.signal} dBm</span>
      </div>
    `;
    els.bleTerminal.innerHTML = state.bleLines.map(render).join("");
    els.miniTerminal.innerHTML = state.miniLines.map(render).join("");
    renderOpsTargets();
  }

  function seedWifi() {
    state.wifiRows = [
      wifiRow("SJCITY-IOT", "WPA2", 6),
      wifiRow("TrafficNode-7F", "WPA3", 11),
      wifiRow("xfinitywifi", "Open", 1),
      wifiRow("ALPR-uplink", "WPA2", 36),
      wifiRow("PublicSafetyNet", "WPA2", 149)
    ];
    state.wifiTotal = state.wifiRows.length;
  }

  function wifiRow(ssid, enc, channel) {
    return {
      ssid,
      enc,
      channel,
      bssid: randomMac(),
      signal: randInt(-88, -44)
    };
  }

  function mutateWifi() {
    if (state.wifiRows.length > 8) state.wifiRows.pop();
    state.wifiRows.unshift(wifiRow(randomChoice([
      "NETGEAR-field",
      "Meridian_AP",
      "Flock-Uplink",
      "RoadSensor-5G",
      "Hidden Network",
      "IoT-Gateway",
      "ALPR-backhaul"
    ]), randomChoice(["WPA2", "WPA3", "Open"]), randomChoice([1, 6, 11, 36, 44, 149])));
  }

  function renderWifiList() {
    els.wifiList.innerHTML = state.wifiRows.map((row) => `
      <div class="wifi-item">
        <strong>${escapeHtml(row.ssid)}</strong>
        <span class="dbm">${row.signal} dBm</span>
        <small>${row.bssid}</small>
        <small>CH ${row.channel} • ${row.enc}</small>
      </div>
    `).join("");
    updateCounters();
    renderOpsTargets();
  }



  function setSafeMode(enabled, persist = true) {
    state.safeMode = Boolean(enabled);
    document.body.classList.toggle("unsafe-mode", !state.safeMode);
    els.safeModeBtn.classList.toggle("safe", state.safeMode);
    els.safeModeBtn.classList.toggle("danger", !state.safeMode);
    els.safeModeBtn.textContent = state.safeMode ? "SAFE:on" : "SAFE:off";
    els.safeModeBtn.setAttribute("aria-pressed", state.safeMode ? "true" : "false");
    if (persist) localStorage.setItem("proxysniff_safe_mode", state.safeMode ? "on" : "off");

    if (els.opsPanel) {
      els.opsPanel.hidden = state.safeMode;
      if (!state.safeMode) {
        renderOpsTargets();
        if (!state.opsLines.length) addOpsLine("SAFE", "Advanced handshake console unlocked.", "armed");
      } else {
        addOpsLine("SAFE", "SAFE mode restored. Handshake console hidden.", "locked", false);
      }
    }
  }

  function renderOpsTargets() {
    if (!els.opsTargets || state.safeMode) return;
    const bleTargets = state.bleLines.slice(0, 3).map((line) => ({
      label: line.name,
      meta: `${line.mac} • ${line.signal} dBm`,
      type: "BLE"
    }));
    const wifiTargets = state.wifiRows.slice(0, 3).map((row) => ({
      label: row.ssid,
      meta: `${row.bssid} • CH ${row.channel} • ${row.signal} dBm`,
      type: "Wi-Fi"
    }));
    const targets = [...wifiTargets, ...bleTargets].slice(0, 6);
    els.opsTargets.innerHTML = targets.map((target, index) => `
      <button class="target-pill ${index === 0 ? "active" : ""}" type="button" data-target="${escapeHtml(target.label)}">
        <strong>${escapeHtml(target.type)}</strong>
        <span>${escapeHtml(target.label)}</span>
        <small>${escapeHtml(target.meta)}</small>
      </button>
    `).join("");

    $$(".target-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".target-pill").forEach((item) => item.classList.remove("active"));
        btn.classList.add("active");
        addOpsLine("TARGET", `${btn.dataset.target || "target"} selected for visual op chain.`, "locked");
      });
    });
  }

  function getActiveOpsTarget() {
    const active = document.querySelector(".target-pill.active");
    if (active?.dataset?.target) return active.dataset.target;
    const wifi = state.wifiRows[0]?.ssid;
    const ble = state.bleLines[0]?.name;
    return wifi || ble || "nearby endpoint";
  }

  function runVisualOp(operation) {
    if (state.safeMode) return;
    const target = getActiveOpsTarget();
    if (state.opsProgressTimer) clearInterval(state.opsProgressTimer);
    els.opsProgress.style.width = "0%";
    let progress = 0;

    const flavor = {
      "DNS Poison": ["resolver path staged", "cache shadow synced", "browser route ghosted"],
      "Handshake Capture": ["probe request mirrored", "handshake buffer armed", "session fingerprint cached"],
      "Beacon Replay": ["beacon frame cloned", "timing window aligned", "signal echo injected"],
      "Captive Pivot": ["portal lure staged", "client splash traced", "redirect tunnel simulated"],
      "Session Spoof": ["token shadow mapped", "device profile masked", "identity drift simulated"],
      "Trace Route": ["hop chain mapped", "gateway latency profiled", "uplink path tagged"]
    }[operation] || ["module armed", "target profiled", "visual chain completed"];

    addOpsLine("INIT", `${operation} → ${target}`, "start");
    els.runtimeLabel.textContent = `${operation.toLowerCase()} armed`;

    state.opsProgressTimer = setInterval(() => {
      progress += randInt(14, 29);
      els.opsProgress.style.width = `${Math.min(progress, 100)}%`;
      const msg = flavor[Math.min(Math.floor(progress / 35), flavor.length - 1)];
      addOpsLine("MITM", msg, `${Math.min(progress, 100)}%`);
      if (progress >= 100) {
        clearInterval(state.opsProgressTimer);
        state.opsProgressTimer = null;
        addOpsLine("DONE", `${operation} rootkit sequence completed.`, "owned");
        setTimeout(() => (els.opsProgress.style.width = "0%"), 900);
      }
    }, 520);
  }

  function addOpsLine(tag, message, status = "ok", renderNow = true) {
    if (!els.opsTerminal) return;
    const line = {
      tag,
      message,
      status,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    };
    state.opsLines.unshift(line);
    state.opsLines = state.opsLines.slice(0, 32);
    if (renderNow) renderOpsTerminal();
  }

  function renderOpsTerminal() {
    if (!els.opsTerminal) return;
    els.opsTerminal.innerHTML = state.opsLines.map((line) => `
      <div class="ops-line">
        <b>${escapeHtml(line.tag)}</b>
        <span>${escapeHtml(line.message)}</span>
        <em>${escapeHtml(line.status)}</em>
      </div>
    `).join("");
  }

  function updateCounters() {
    els.bleCount.textContent = formatNumber(state.bleTotal);
    els.wifiCount.textContent = formatNumber(state.wifiTotal);
  }

  function distanceFeet(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return meters * 3.28084;
  }

  function formatDistance(feet) {
    if (!Number.isFinite(feet)) return "--";
    if (feet < 1000) return `${Math.round(feet)} ft`;
    return `${(feet / 5280).toFixed(feet < 5280 * 10 ? 2 : 1)} mi`;
  }

  function formatNumber(num) {
    return new Intl.NumberFormat().format(num || 0);
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomChoice(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomMac() {
    return Array.from({ length: 6 }, () => randInt(0, 255).toString(16).padStart(2, "0").toUpperCase()).join(":");
  }

  function randomPayload(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < length; i += 1) out += chars[randInt(0, chars.length - 1)];
    return out;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[char]));
  }
})();
