(() => {
  "use strict";

  const APP_VERSION = "1.9.0";
  const PINS_STORAGE_KEY = "proxysniff_pinned_spots";

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
    routeLayer: null,
    routeCameraLayer: null,
    pinLayer: null,
    userMarker: null,
    destinationMarker: null,
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
    activeRoute: null,
    routeLatLngs: [],
    routePointDistances: [],
    routeSteps: [],
    routeStartedAt: 0,
    routeEtaAnnounceInterval: 0,
    lastEtaAnnounceAt: 0,
    lastStreetName: "",
    lastStreetAnnounceAt: 0,
    spokenStepIds: new Set(),
    routeCameraIds: new Set(),
    cameraAlertHistory: new Set(),
    lastCameraAlertAt: 0,
    speechQueue: [],
    speechSpeaking: false,
    speechUnlocked: false,
    speechEnabled: false,
    pins: [],
    activePinDraft: null,
    placeSearch: {
      address: { timer: null, items: [], selected: null },
      destination: { timer: null, items: [], selected: null }
    },
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
    voiceBtn: $("#voiceBtn"),
    recenterBtn: $("#recenterBtn"),
    pinSpotBtn: $("#pinSpotBtn"),
    stopNavigationBtn: $("#stopNavigationBtn"),
    fullscreenMapBtn: $("#fullscreenMapBtn"),
    demoDriveBtn: $("#demoDriveBtn"),
    fitCamsBtn: $("#fitCamsBtn"),
    coordsChip: $("#coordsChip"),
    areaChip: $("#areaChip"),
    flockChip: $("#flockChip"),
    visibleChip: $("#visibleChip"),
    followChip: $("#followChip"),
    maneuverChip: $("#maneuverChip"),
    etaChip: $("#etaChip"),
    routeChip: $("#routeChip"),
    pinnedList: $("#pinnedList"),
    newPinBtn: $("#newPinBtn"),
    pinModal: $("#pinModal"),
    pinForm: $("#pinForm"),
    closePinModalBtn: $("#closePinModalBtn"),
    cancelPinBtn: $("#cancelPinBtn"),
    pinModalTitle: $("#pinModalTitle"),
    pinNameInput: $("#pinNameInput"),
    pinDescriptionInput: $("#pinDescriptionInput"),
    pinPhotoInput: $("#pinPhotoInput"),
    pinPreview: $("#pinPreview"),
    pinMeta: $("#pinMeta"),
    removePinPhotoBtn: $("#removePinPhotoBtn"),
    savePinBtn: $("#savePinBtn"),
    pinDestinationBtn: $("#pinDestinationBtn"),
    addressForm: $("#addressForm"),
    addressInput: $("#addressInput"),
    addressSuggestions: $("#addressSuggestions"),
    destinationForm: $("#destinationForm"),
    destinationInput: $("#destinationInput"),
    destinationSuggestions: $("#destinationSuggestions"),
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
    loadPins();
    wireEvents();
    setSafeMode(state.safeMode, false);
    seedWifi();
    renderWifiList();
    renderPinnedSpots();
    startScanner();
    await loadCameraPack(state.activePack);
    setTimeout(() => {
      els.splash.classList.add("done");
      els.app.classList.remove("is-hidden");
      setTimeout(() => (els.splash.style.display = "none"), 650);
    }, 900);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./service-worker.js?v=1.9.0").catch(() => {});
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
    els.voiceBtn?.addEventListener("click", toggleVoiceAlerts);
    els.recenterBtn.addEventListener("click", recenterOnUser);
    els.pinSpotBtn.addEventListener("click", openPinModalAtMapCenter);
    els.stopNavigationBtn.addEventListener("click", stopNavigation);
    els.fullscreenMapBtn.addEventListener("click", toggleMapFullscreen);
    els.fitCamsBtn.addEventListener("click", fitCameraBounds);
    els.demoDriveBtn.addEventListener("click", toggleDemoDrive);
    els.addressForm.addEventListener("submit", searchAddress);
    els.destinationForm.addEventListener("submit", routeToDestination);
    wirePlaceSuggestions("address", els.addressInput, els.addressSuggestions);
    wirePlaceSuggestions("destination", els.destinationInput, els.destinationSuggestions);
    els.newPinBtn?.addEventListener("click", () => {
      navigate("map");
      setTimeout(openPinModalAtMapCenter, 220);
    });
    els.closePinModalBtn?.addEventListener("click", closePinModal);
    els.cancelPinBtn?.addEventListener("click", closePinModal);
    els.pinForm?.addEventListener("submit", savePinFromForm);
    els.pinDestinationBtn?.addEventListener("click", saveDestinationPinFromForm);
    els.pinNameInput?.addEventListener("input", () => els.pinNameInput.setCustomValidity(""));
    els.pinPhotoInput?.addEventListener("change", handlePinPhotoChange);
    els.removePinPhotoBtn?.addEventListener("click", removePinDraftPhoto);
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
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".searchbar")) hidePlaceSuggestions();
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
        renderPinMarkers();
      }, 150);
      setTimeout(() => {
        state.map?.invalidateSize();
        renderVisibleCameras();
        renderPinMarkers();
      }, 650);
    }

    if (view === "pinned") renderPinnedSpots();
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
    state.routeLayer = L.layerGroup().addTo(state.map);
    state.routeCameraLayer = L.layerGroup().addTo(state.map);
    state.pinLayer = L.layerGroup().addTo(state.map);
    state.map.on("moveend zoomend", renderVisibleCameras);
    state.map.on("dragstart", () => {
      if (state.followUser) setFollowMode(false);
    });
    renderVisibleCameras();
    renderPinMarkers();
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
      if (state.renderedMarkers.has(cam.id)) {
        state.renderedMarkers.get(cam.id).setStyle(cameraMarkerStyle(cam, zoom));
        continue;
      }
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
    const isRouteCamera = state.routeCameraIds.has(cam.id);
    const radius = zoom < 9 ? 4 : zoom < 12 ? 6 : 8;
    return {
      className: "camera-marker",
      radius,
      color: isRouteCamera ? "#ffb239" : isFlock ? "#18a8ff" : isMotorola ? "#8f7bff" : "#70c7ff",
      weight: isRouteCamera ? 3 : 2,
      opacity: 0.95,
      fillColor: isRouteCamera ? "#ffb239" : isFlock ? "#0aa2ff" : isMotorola ? "#8f7bff" : "#80d8ff",
      fillOpacity: isRouteCamera ? 0.52 : isFlock ? 0.42 : 0.3
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

  function getFreshUserPosition(timeout = 8000) {
    initMapOnce();
    if (state.lastPosition && Date.now() - state.lastPosition.timestamp < 20000) {
      return Promise.resolve(state.lastPosition);
    }

    if (!navigator.geolocation) return Promise.resolve(null);
    ensureLocationWatch();

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(state.lastPosition || null);
      }, timeout);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          onLocation(position);
          resolve(state.lastPosition);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(state.lastPosition || null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout
        }
      );
    });
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
    updateRouteGuidance();
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

  function wirePlaceSuggestions(kind, input, list) {
    if (!input || !list) return;
    input.addEventListener("input", () => schedulePlaceSuggestions(kind, input, list));
    input.addEventListener("focus", () => {
      if (state.placeSearch[kind].items.length) renderPlaceSuggestions(kind, input, list);
      else schedulePlaceSuggestions(kind, input, list);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hidePlaceSuggestions(kind);
    });
  }

  function schedulePlaceSuggestions(kind, input, list) {
    const bucket = state.placeSearch[kind];
    bucket.selected = null;
    clearTimeout(bucket.timer);

    const query = input.value.trim();
    if (query.length < 2) {
      bucket.items = [];
      hidePlaceSuggestions(kind);
      return;
    }

    bucket.timer = setTimeout(async () => {
      try {
        if (input.value.trim() !== query) return;
        const items = await findNearbyPlaceMatches(query);
        if (input.value.trim() !== query) return;
        bucket.items = items;
        renderPlaceSuggestions(kind, input, list);
      } catch (error) {
        console.warn("Place suggestions failed:", error);
        bucket.items = [];
        hidePlaceSuggestions(kind);
      }
    }, 280);
  }

  async function findNearbyPlaceMatches(query) {
    initMapOnce();
    const origin = await getSuggestionOrigin();
    const searchQuery = normalizePlaceQuery(query);
    const [localResults, poiResults] = await Promise.all([
      fetchNominatimSuggestions(searchQuery, origin, 0.28, true).catch(() => []),
      fetchTargetedPoiSuggestions(query, origin).catch(() => [])
    ]);
    const merged = mergePlaceResults([...poiResults, ...localResults]);
    if (merged.length) return merged;

    return fetchNominatimSuggestions(searchQuery, origin, 0.75, false);
  }

  async function fetchTargetedPoiSuggestions(query, origin) {
    const filter = buildTargetedPoiFilter(query);
    if (!filter) return [];

    const radiusMeters = 16093;
    const overpassQuery = `[out:json][timeout:5];
      (
        ${filter.replaceAll("{{radius}}", radiusMeters).replaceAll("{{lat}}", origin.lat).replaceAll("{{lng}}", origin.lng)}
      );
      out center tags 20;`;

    const payload = await fetchOverpassWithTimeout(overpassQuery, 2800);
    return (payload.elements || [])
      .map((item) => normalizeOsmElementPlace(item, origin))
      .filter(Boolean)
      .sort((a, b) => a.feet - b.feet)
      .slice(0, 8);
  }

  async function fetchOverpassWithTimeout(query, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: query,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`POI HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildTargetedPoiFilter(query) {
    const value = query.trim().toLowerCase();
    if (value === "711" || value === "7 11" || value === "7-11" || value === "7-eleven") {
      return `
        nwr(around:{{radius}},{{lat}},{{lng}})["brand"~"7[- ]?Eleven",i];
        nwr(around:{{radius}},{{lat}},{{lng}})["name"~"7[- ]?Eleven",i];`;
    }
    if (value.includes("burger king")) {
      return `
        nwr(around:{{radius}},{{lat}},{{lng}})["brand"~"Burger King",i];
        nwr(around:{{radius}},{{lat}},{{lng}})["name"~"Burger King",i];`;
    }
    if (value.includes("safeway")) {
      return `
        nwr(around:{{radius}},{{lat}},{{lng}})["brand"~"Safeway",i];
        nwr(around:{{radius}},{{lat}},{{lng}})["name"~"Safeway",i];`;
    }
    if (value === "gas" || value === "fuel" || value.includes("gas station")) {
      return `nwr(around:{{radius}},{{lat}},{{lng}})["amenity"="fuel"];`;
    }
    if (value === "food" || value === "restaurant" || value === "restaurants") {
      return `
        nwr(around:{{radius}},{{lat}},{{lng}})["amenity"="restaurant"];
        nwr(around:{{radius}},{{lat}},{{lng}})["amenity"="fast_food"];`;
    }
    return "";
  }

  async function fetchNominatimSuggestions(searchQuery, origin, pad, bounded) {
    const viewbox = getSuggestionViewbox(origin.lat, origin.lng, pad);
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&extratags=1&dedupe=1&limit=12&countrycodes=us&bounded=${bounded ? 1 : 0}&viewbox=${viewbox}&q=${encodeURIComponent(searchQuery)}`;
    const results = await fetchJsonWithTimeout(url, 4200);
    const seen = new Set();

    return results
      .map((result) => normalizePlaceResult(result, origin))
      .filter((item) => dedupePlaceResult(item, seen))
      .sort((a, b) => a.feet - b.feet)
      .slice(0, 8);
  }

  function mergePlaceResults(items) {
    const seen = new Set();
    return items
      .filter((item) => dedupePlaceResult(item, seen))
      .sort((a, b) => a.feet - b.feet)
      .slice(0, 8);
  }

  function dedupePlaceResult(item, seen) {
    if (!item) return false;
    const key = `${item.name.toLowerCase()}|${Math.round(item.lat * 10000)}|${Math.round(item.lng * 10000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Suggestions HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizePlaceQuery(query) {
    const value = query.trim().toLowerCase();
    if (value === "711" || value === "7 11" || value === "7-11") return "7-Eleven";
    if (value === "gas" || value === "fuel" || value === "gas stations") return "gas station";
    if (value === "food" || value === "restaurants" || value === "restaurant") return "restaurant";
    if (value === "coffee") return "coffee shop";
    if (value === "groceries" || value === "grocery") return "grocery store";
    return query;
  }

  async function getSuggestionOrigin() {
    const freshPosition = await getFreshUserPosition(2500);
    if (freshPosition) return freshPosition;
    if (state.lastPosition) return state.lastPosition;
    const center = state.map?.getCenter();
    return {
      lat: center?.lat ?? DEFAULT_CENTER[0],
      lng: center?.lng ?? DEFAULT_CENTER[1]
    };
  }

  function getSuggestionViewbox(lat, lng, pad = 0.45) {
    const left = lng - pad;
    const right = lng + pad;
    const top = lat + pad;
    const bottom = lat - pad;
    return `${left},${top},${right},${bottom}`;
  }

  function normalizePlaceResult(result, origin) {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const display = result.display_name || "";
    const parts = display.split(",").map((part) => part.trim()).filter(Boolean);
    const name = result.namedetails?.name || result.name || parts[0] || "Place";
    const address = parts.slice(name === parts[0] ? 1 : 0, 4).join(", ") || display || "Address unavailable";
    const feet = distanceFeet(origin.lat, origin.lng, lat, lng);

    return {
      lat,
      lng,
      name,
      address,
      feet,
      label: display || `${name}, ${address}`
    };
  }

  function normalizeOsmElementPlace(item, origin) {
    const tags = item.tags || {};
    const lat = Number(item.lat ?? item.center?.lat);
    const lng = Number(item.lon ?? item.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const name = tags.name || tags.brand || getPoiFallbackName(tags);
    const address = formatTaggedAddress(tags) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const feet = distanceFeet(origin.lat, origin.lng, lat, lng);

    return {
      lat,
      lng,
      name,
      address,
      feet,
      label: `${name}, ${address}`
    };
  }

  function getPoiFallbackName(tags) {
    if (tags.amenity === "fuel") return "Gas Station";
    if (tags.amenity === "fast_food") return "Fast Food";
    if (tags.amenity === "restaurant") return "Restaurant";
    return "Place";
  }

  function formatTaggedAddress(tags) {
    const street = tags["addr:street"];
    const house = tags["addr:housenumber"];
    const city = tags["addr:city"] || tags["addr:town"] || tags["addr:suburb"];
    const stateName = tags["addr:state"];
    const line1 = [house, street].filter(Boolean).join(" ");
    const line2 = [city, stateName].filter(Boolean).join(", ");
    return [line1, line2].filter(Boolean).join(", ");
  }

  function renderPlaceSuggestions(kind, input, list) {
    const bucket = state.placeSearch[kind];
    if (!bucket.items.length || input.value.trim().length < 2) {
      hidePlaceSuggestions(kind);
      return;
    }

    list.innerHTML = bucket.items.map((item, index) => `
      <button class="place-suggestion" type="button" data-place-index="${index}">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.address)}</span>
        <small>${escapeHtml(formatDistance(item.feet))}</small>
      </button>
    `).join("");

    list.hidden = false;
    list.querySelectorAll("[data-place-index]").forEach((btn) => {
      btn.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectPlaceSuggestion(kind, input, list, Number(btn.dataset.placeIndex));
      });
    });
  }

  function selectPlaceSuggestion(kind, input, list, index) {
    const item = state.placeSearch[kind].items[index];
    if (!item) return;
    state.placeSearch[kind].selected = item;
    input.value = item.label;
    list.hidden = true;
    els.runtimeLabel.textContent = `selected ${item.name}`;
  }

  function hidePlaceSuggestions(kind = null) {
    const lists = kind
      ? [kind === "address" ? els.addressSuggestions : els.destinationSuggestions]
      : [els.addressSuggestions, els.destinationSuggestions];
    lists.forEach((list) => {
      if (list) list.hidden = true;
    });
  }

  function getSelectedPlace(kind, input) {
    const selected = state.placeSearch[kind]?.selected;
    if (!selected || selected.label !== input.value.trim()) return null;
    return {
      lat: selected.lat,
      lng: selected.lng,
      label: selected.label
    };
  }

  async function searchAddress(event) {
    event.preventDefault();
    const query = els.addressInput.value.trim();
    if (!query) return;
    initMapOnce();
    setFollowMode(false);
    els.runtimeLabel.textContent = "searching map";
    try {
      const place = getSelectedPlace("address", els.addressInput) || await geocodePlace(query);
      hidePlaceSuggestions("address");
      if (!place) {
        els.runtimeLabel.textContent = "no map result found";
        return;
      }
      state.map.setView([place.lat, place.lng], 15, { animate: true });
      const searchLabel = place.label.split(",").slice(0, 3).join(",").trim();
      state.viewAreaLabel = searchLabel || query;
      els.runtimeLabel.textContent = `viewing ${place.label.split(",").slice(0, 2).join(",").trim()}`;
      refreshAreaChip();
    } catch (error) {
      console.warn(error);
      els.runtimeLabel.textContent = "address search failed";
    }
  }

  async function routeToDestination(event) {
    event.preventDefault();
    unlockSpeech(false);
    const query = els.destinationInput.value.trim();
    if (!query) return;

    try {
      const destination = getSelectedPlace("destination", els.destinationInput) || await geocodePlace(query);
      hidePlaceSuggestions("destination");
      if (!destination) {
        initMapOnce();
        els.runtimeLabel.textContent = "destination not found";
        setRouteChip("route: destination not found");
        return;
      }
      await routeToPoint(destination);
    } catch (error) {
      console.warn(error);
      els.runtimeLabel.textContent = "route failed";
      setRouteChip("route: mapping failed");
    }
  }

  async function routeToPoint(destination) {
    initMapOnce();
    ensureLocationWatch();
    els.runtimeLabel.textContent = "routing destination";
    setRouteChip("route: finding destination");

    const origin = await getRouteOrigin();
    if (!origin) {
      els.runtimeLabel.textContent = "GPS needed for route";
      setRouteChip("route: current location needed");
      return;
    }
    setRouteChip("route: mapping drive");
    const route = await fetchDrivingRoute(origin, destination);
    drawRoute(origin, destination, route);
  }

  async function geocodePlace(query) {
    const nearby = await findNearbyPlaceMatches(query);
    if (nearby.length) {
      return {
        lat: nearby[0].lat,
        lng: nearby[0].lng,
        label: nearby[0].label
      };
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`Geocode HTTP ${response.status}`);
    const results = await response.json();
    if (!results.length) return null;
    const result = results[0];
    return {
      lat: Number(result.lat),
      lng: Number(result.lon),
      label: result.display_name || query
    };
  }

  async function getRouteOrigin() {
    const position = await getFreshUserPosition(9000);
    if (position) {
      return {
        lat: position.lat,
        lng: position.lng,
        label: "Current location"
      };
    }

    return null;
  }

  async function fetchDrivingRoute(origin, destination) {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`Route HTTP ${response.status}`);
    const payload = await response.json();
    const route = payload?.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error("No route geometry returned");
    return route;
  }

  function drawRoute(origin, destination, route) {
    if (!state.map || !state.routeLayer || !state.routeCameraLayer) return;

    state.routeLayer.clearLayers();
    state.routeCameraLayer.clearLayers();
    state.routeCameraIds.clear();
    state.cameraAlertHistory.clear();
    state.spokenStepIds.clear();
    state.lastStreetName = "";
    state.lastStreetAnnounceAt = 0;
    state.lastCameraAlertAt = 0;

    const routeLatLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    state.routeLatLngs = routeLatLngs;
    state.routePointDistances = buildRoutePointDistances(routeLatLngs);
    state.routeSteps = normalizeRouteSteps(route, routeLatLngs);
    const routeLine = L.polyline(routeLatLngs, {
      className: "route-line",
      color: "#ffb239",
      weight: 6,
      opacity: 0.92,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(state.routeLayer);

    L.polyline(routeLatLngs, {
      color: "#2effc8",
      weight: 2,
      opacity: 0.88,
      dashArray: "8 12"
    }).addTo(state.routeLayer);

    if (state.destinationMarker) {
      state.destinationMarker.setLatLng([destination.lat, destination.lng]);
    } else {
      state.destinationMarker = L.circleMarker([destination.lat, destination.lng], {
        className: "destination-marker",
        radius: 10,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ffb239",
        fillOpacity: 0.9
      });
    }
    state.destinationMarker.bindPopup(`<b>Destination</b><br>${escapeHtml(destination.label.split(",").slice(0, 3).join(",").trim())}`);
    state.destinationMarker.addTo(state.routeLayer);

    const nearby = getCamerasNearRoute(routeLatLngs, 700).slice(0, 260);
    for (const item of nearby) {
      state.routeCameraIds.add(item.cam.id);
      L.circleMarker([item.cam.lat, item.cam.lng], {
        className: "route-camera-marker",
        radius: 10,
        color: "#ffb239",
        weight: 3,
        opacity: 0.95,
        fillColor: "#ffb239",
        fillOpacity: 0.18
      }).bindPopup(createCameraPopup(item.cam)).addTo(state.routeCameraLayer);
    }

    state.activeRoute = { origin, destination, distance: route.distance, duration: route.duration };
    updatePinDestinationButton();
    const miles = route.distance / 1609.344;
    const minutes = Math.round(route.duration / 60);
    const label = destination.label.split(",").slice(0, 2).join(",").trim();
    els.runtimeLabel.textContent = `route ready: ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
    setRouteChip(`route: ${miles.toFixed(miles < 10 ? 1 : 0)} mi / ${minutes} min / ${nearby.length} cams`);
    if (els.stopNavigationBtn) els.stopNavigationBtn.hidden = false;
    state.routeStartedAt = Date.now();
    state.lastEtaAnnounceAt = state.routeStartedAt;
    state.routeEtaAnnounceInterval = Math.max(60000, (route.duration * 1000) / 4);
    updateEtaChip(route.duration);
    updateManeuverChip();
    enqueueSpeech(`Route ready. Estimated arrival in ${formatDurationSpeech(route.duration)}.`, "eta");
    state.viewAreaLabel = label || destination.label;
    refreshAreaChip();
    renderVisibleCameras();

    const bounds = routeLine.getBounds();
    if (state.lastPosition) bounds.extend([state.lastPosition.lat, state.lastPosition.lng]);
    state.map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }

  function stopNavigation() {
    state.activeRoute = null;
    updatePinDestinationButton();
    state.routeLatLngs = [];
    state.routePointDistances = [];
    state.routeSteps = [];
    state.routeCameraIds.clear();
    state.cameraAlertHistory.clear();
    state.spokenStepIds.clear();
    state.lastStreetName = "";
    state.routeEtaAnnounceInterval = 0;
    state.speechQueue = [];
    state.speechSpeaking = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    state.routeLayer?.clearLayers();
    state.routeCameraLayer?.clearLayers();
    if (els.stopNavigationBtn) els.stopNavigationBtn.hidden = true;
    if (els.routeChip) {
      els.routeChip.textContent = "route: idle";
      els.routeChip.hidden = true;
    }
    if (els.maneuverChip) els.maneuverChip.textContent = "next turn: route inactive";
    if (els.etaChip) els.etaChip.textContent = "ETA --";
    els.runtimeLabel.textContent = "navigation stopped";
    renderVisibleCameras();
  }

  function loadPins() {
    try {
      const stored = JSON.parse(localStorage.getItem(PINS_STORAGE_KEY) || "[]");
      state.pins = Array.isArray(stored) ? stored.filter((pin) => Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) : [];
    } catch (error) {
      console.warn("Pinned spots failed to load:", error);
      state.pins = [];
    }
  }

  function savePins() {
    try {
      localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(state.pins));
    } catch (error) {
      console.warn("Pinned spots failed to save:", error);
      els.runtimeLabel.textContent = "pin storage full";
    }
  }

  async function openPinModalAtMapCenter() {
    initMapOnce();
    if (!state.map) return;
    ensureLocationWatch();
    const target = getCurrentPinTarget();
    const draft = {
      id: `pin-${Date.now()}-${randInt(1000, 9999)}`,
      lat: target.lat,
      lng: target.lng,
      address: "Looking up address...",
      photo: "",
      source: target.source,
      mode: "create",
      createdAt: Date.now()
    };
    state.activePinDraft = draft;
    els.pinForm.reset();
    els.pinModalTitle.textContent = "Save Spot";
    els.savePinBtn.textContent = "Save Pin";
    els.pinNameInput.value = "";
    els.pinDescriptionInput.value = "";
    renderPinPhotoPreview("");
    els.pinMeta.textContent = `${target.label}: ${target.lat.toFixed(6)}, ${target.lng.toFixed(6)} - Looking up address...`;
    updatePinDestinationButton();
    els.pinModal.hidden = false;
    els.pinNameInput.focus();

    try {
      draft.address = await reverseGeocodePoint(target.lat, target.lng);
      if (state.activePinDraft?.id === draft.id) {
        state.activePinDraft.address = draft.address;
        els.pinMeta.textContent = `${target.label}: ${target.lat.toFixed(6)}, ${target.lng.toFixed(6)} - ${draft.address}`;
      }
    } catch (error) {
      console.warn("Pin address lookup failed:", error);
      draft.address = `Near ${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`;
      if (state.activePinDraft?.id === draft.id) {
        state.activePinDraft.address = draft.address;
        els.pinMeta.textContent = `${target.label}: ${target.lat.toFixed(6)}, ${target.lng.toFixed(6)} - ${draft.address}`;
      }
    }
  }

  function closePinModal() {
    state.activePinDraft = null;
    els.pinModal.hidden = true;
  }

  function getCurrentPinTarget() {
    if (state.lastPosition) {
      return {
        lat: state.lastPosition.lat,
        lng: state.lastPosition.lng,
        label: "Current location",
        source: "current"
      };
    }

    const center = state.map?.getCenter();
    return {
      lat: center?.lat ?? DEFAULT_CENTER[0],
      lng: center?.lng ?? DEFAULT_CENTER[1],
      label: "Map center",
      source: "map"
    };
  }

  function getDestinationPinTarget() {
    const destination = state.activeRoute?.destination;
    if (!destination || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) return null;
    return {
      lat: destination.lat,
      lng: destination.lng,
      label: "Destination",
      source: "destination",
      address: destination.label || "Destination"
    };
  }

  function updatePinDestinationButton() {
    if (!els.pinDestinationBtn) return;
    els.pinDestinationBtn.hidden = state.activePinDraft?.mode === "edit" || !getDestinationPinTarget();
  }

  function renderPinPhotoPreview(photo) {
    if (photo) {
      els.pinPreview.innerHTML = `<img src="${photo}" alt="Pinned spot preview" />`;
    } else {
      els.pinPreview.innerHTML = "<span>No photo selected</span>";
    }
    if (els.removePinPhotoBtn) els.removePinPhotoBtn.hidden = !photo;
  }

  async function handlePinPhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file || !state.activePinDraft) return;
    try {
      const dataUrl = await resizeImageFile(file, 420);
      state.activePinDraft.photo = dataUrl;
      renderPinPhotoPreview(dataUrl);
    } catch (error) {
      console.warn("Pin photo failed:", error);
      els.pinPreview.innerHTML = "<span>Photo could not be loaded</span>";
    }
  }

  function removePinDraftPhoto() {
    if (!state.activePinDraft) return;
    state.activePinDraft.photo = "";
    if (els.pinPhotoInput) els.pinPhotoInput.value = "";
    renderPinPhotoPreview("");
  }

  function validatePinName() {
    const name = els.pinNameInput.value.trim();
    if (name) {
      els.pinNameInput.setCustomValidity("");
      return name;
    }

    els.pinNameInput.setCustomValidity("Add a name before saving this pinned location.");
    els.pinNameInput.reportValidity();
    els.runtimeLabel.textContent = "pin needs a name";
    return "";
  }

  function savePinFromForm(event) {
    event.preventDefault();
    if (state.activePinDraft?.mode === "edit") {
      saveEditedPinFromForm();
      return;
    }
    savePinWithTarget(getCurrentPinTarget());
  }

  function saveDestinationPinFromForm(event) {
    event.preventDefault();
    const target = getDestinationPinTarget();
    if (target) savePinWithTarget(target);
  }

  function savePinWithTarget(target) {
    const draft = state.activePinDraft;
    const name = validatePinName();
    if (!draft || !name) return;

    const pin = {
      ...draft,
      lat: target.lat,
      lng: target.lng,
      address: target.address || draft.address,
      source: target.source,
      name,
      description: els.pinDescriptionInput.value.trim(),
      updatedAt: Date.now()
    };
    state.pins.unshift(pin);
    savePins();
    closePinModal();
    renderPinnedSpots();
    renderPinMarkers();
    els.runtimeLabel.textContent = target.source === "destination" ? "destination pinned" : "pin saved";
  }

  function openEditPinModal(id) {
    const pin = state.pins.find((item) => item.id === id);
    if (!pin) return;

    state.activePinDraft = {
      ...pin,
      mode: "edit"
    };
    els.pinForm.reset();
    els.pinModalTitle.textContent = "Edit Spot";
    els.savePinBtn.textContent = "Save Changes";
    els.pinNameInput.value = pin.name || "";
    els.pinDescriptionInput.value = pin.description || "";
    renderPinPhotoPreview(pin.photo || "");
    els.pinMeta.textContent = `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)} - ${pin.address || "Address unavailable"}`;
    updatePinDestinationButton();
    els.pinModal.hidden = false;
    els.pinNameInput.focus();
  }

  function saveEditedPinFromForm() {
    const draft = state.activePinDraft;
    const name = validatePinName();
    if (!draft || !name) return;

    const index = state.pins.findIndex((pin) => pin.id === draft.id);
    if (index === -1) return;

    state.pins[index] = {
      ...state.pins[index],
      name,
      description: els.pinDescriptionInput.value.trim(),
      photo: draft.photo || "",
      updatedAt: Date.now()
    };
    savePins();
    closePinModal();
    renderPinnedSpots();
    renderPinMarkers();
    els.runtimeLabel.textContent = "pin updated";
  }

  function renderPinnedSpots() {
    if (!els.pinnedList) return;
    if (!state.pins.length) {
      els.pinnedList.innerHTML = `
        <div class="empty-pins">
          <strong>No pinned spots yet</strong>
          <span>Open the heat map, move the map to a spot, then tap the pin button.</span>
        </div>
      `;
      return;
    }

    els.pinnedList.innerHTML = state.pins.map((pin) => `
      <article class="pin-card">
        <div class="pin-thumb">${pin.photo ? `<img src="${pin.photo}" alt="" />` : "<span>PIN</span>"}</div>
        <div class="pin-copy">
          <strong>${escapeHtml(pin.name)}</strong>
          <span>${escapeHtml(pin.address || "Address unavailable")}</span>
          <small>${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}</small>
          ${pin.description ? `<p>${escapeHtml(pin.description)}</p>` : ""}
        </div>
        <div class="pin-actions">
          <button class="primary-btn" type="button" data-pin-route="${escapeHtml(pin.id)}">Route</button>
          <button class="ghost-btn" type="button" data-pin-view="${escapeHtml(pin.id)}">View</button>
          <button class="ghost-btn" type="button" data-pin-edit="${escapeHtml(pin.id)}">Edit</button>
          <button class="ghost-btn danger-ghost" type="button" data-pin-delete="${escapeHtml(pin.id)}">Delete</button>
        </div>
      </article>
    `).join("");

    $$("[data-pin-route]").forEach((btn) => btn.addEventListener("click", () => routeToSavedPin(btn.dataset.pinRoute)));
    $$("[data-pin-view]").forEach((btn) => btn.addEventListener("click", () => viewSavedPin(btn.dataset.pinView)));
    $$("[data-pin-edit]").forEach((btn) => btn.addEventListener("click", () => openEditPinModal(btn.dataset.pinEdit)));
    $$("[data-pin-delete]").forEach((btn) => btn.addEventListener("click", () => deleteSavedPin(btn.dataset.pinDelete)));
  }

  function renderPinMarkers() {
    if (!state.mapReady || !state.pinLayer) return;
    state.pinLayer.clearLayers();
    for (const pin of state.pins) {
      const marker = L.circleMarker([pin.lat, pin.lng], {
        className: "saved-pin-marker",
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: "#2effc8",
        fillOpacity: 0.86
      }).addTo(state.pinLayer);
      marker.bindPopup(createPinPopup(pin));
      marker.on("click", () => {
        els.runtimeLabel.textContent = `pin: ${pin.name}`;
      });
    }
  }

  function createPinPopup(pin) {
    return `
      <div class="popup-card pin-popup">
        ${pin.photo ? `<img src="${pin.photo}" alt="" />` : ""}
        <h3>${escapeHtml(pin.name)}</h3>
        <p>${escapeHtml(pin.description || pin.address || "Pinned spot")}</p>
        <div class="popup-grid">
          <span>Address</span><span>${escapeHtml(pin.address || "--")}</span>
          <span>Coords</span><span>${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}</span>
        </div>
      </div>`;
  }

  async function routeToSavedPin(id) {
    const pin = state.pins.find((item) => item.id === id);
    if (!pin) return;
    navigate("map");
    els.destinationInput.value = pin.name;
    await routeToPoint({ lat: pin.lat, lng: pin.lng, label: pin.name || pin.address || "Pinned spot" });
  }

  function viewSavedPin(id) {
    const pin = state.pins.find((item) => item.id === id);
    if (!pin) return;
    navigate("map");
    initMapOnce();
    setFollowMode(false);
    state.map?.setView([pin.lat, pin.lng], 17, { animate: true });
    setAreaChip(pin.address || pin.name);
  }

  function deleteSavedPin(id) {
    state.pins = state.pins.filter((pin) => pin.id !== id);
    savePins();
    renderPinnedSpots();
    renderPinMarkers();
    els.runtimeLabel.textContent = "pin deleted";
  }

  async function reverseGeocodePoint(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`Reverse geocode HTTP ${response.status}`);
    const result = await response.json();
    return formatReverseAddress(result) || `Near ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  function resizeImageFile(file, maxSize) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("File read failed"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Image decode failed"));
        image.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function setRouteChip(text) {
    if (!els.routeChip) return;
    els.routeChip.hidden = false;
    els.routeChip.textContent = text;
  }

  function normalizeRouteSteps(route, routeLatLngs) {
    const steps = (route.legs || []).flatMap((leg) => leg.steps || []);
    return steps.map((step, index) => {
      const location = step.maneuver?.location || [];
      const latlng = [Number(location[1]), Number(location[0])];
      return {
        id: `${index}-${step.maneuver?.type || "step"}-${step.maneuver?.modifier || ""}`,
        index,
        name: step.name || "",
        distance: step.distance || 0,
        duration: step.duration || 0,
        latlng,
        routeIndex: findClosestRouteIndex(latlng[0], latlng[1], routeLatLngs),
        instruction: buildManeuverInstruction(step)
      };
    }).filter((step) => Number.isFinite(step.latlng[0]) && Number.isFinite(step.latlng[1]));
  }

  function buildRoutePointDistances(routeLatLngs) {
    const distances = [0];
    for (let i = 1; i < routeLatLngs.length; i += 1) {
      distances[i] = distances[i - 1] + distanceFeet(routeLatLngs[i - 1][0], routeLatLngs[i - 1][1], routeLatLngs[i][0], routeLatLngs[i][1]);
    }
    return distances;
  }

  function buildManeuverInstruction(step) {
    const type = step.maneuver?.type || "continue";
    const modifier = step.maneuver?.modifier || "";
    const street = step.name ? ` onto ${step.name}` : "";
    const direction = modifier.replace("uturn", "U-turn");

    if (type === "depart") return step.name ? `Head ${direction || "out"} on ${step.name}` : "Start driving";
    if (type === "arrive") return "Arrive at your destination";
    if (type === "turn") return `Turn ${direction}${street}`;
    if (type === "new name") return step.name ? `Continue onto ${step.name}` : "Continue ahead";
    if (type === "merge") return `Merge ${direction}${street}`;
    if (type === "on ramp") return `Take the ramp ${direction}${street}`;
    if (type === "off ramp") return `Take the exit ${direction}${street}`;
    if (type === "fork") return `Keep ${direction}${street}`;
    if (type === "roundabout" || type === "rotary") return `Enter the roundabout${street}`;
    if (type === "notification") return step.name ? `Continue on ${step.name}` : "Continue ahead";
    return `${type.replace(/-/g, " ")} ${direction}${street}`.replace(/\s+/g, " ").trim();
  }

  function updateRouteGuidance() {
    if (!state.activeRoute || !state.routeLatLngs.length || !state.lastPosition) return;

    const progress = getRouteProgress(state.lastPosition.lat, state.lastPosition.lng);
    const remainingRatio = Math.max(0, 1 - (progress.distanceFeet / Math.max(state.activeRoute.distance * 3.28084, 1)));
    const remainingSeconds = Math.max(0, state.activeRoute.duration * remainingRatio);
    updateEtaChip(remainingSeconds);
    maybeAnnounceEta(remainingSeconds);
    updateManeuverChip(progress.index);
    maybeAnnounceStreet(progress.index);
    maybeAnnounceNextManeuver(progress.index);
    maybeAnnounceCameraAlert();
  }

  function getRouteProgress(lat, lng) {
    const index = findClosestRouteIndex(lat, lng, state.routeLatLngs);
    return {
      index,
      distanceFeet: state.routePointDistances[index] || 0
    };
  }

  function updateEtaChip(remainingSeconds) {
    if (!els.etaChip) return;
    if (!state.activeRoute) {
      els.etaChip.textContent = "ETA --";
      return;
    }
    const arrival = new Date(Date.now() + Math.max(0, remainingSeconds) * 1000);
    const time = arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    els.etaChip.textContent = `ETA ${time} / ${formatDurationShort(remainingSeconds)}`;
  }

  function updateManeuverChip(routeIndex = 0) {
    if (!els.maneuverChip) return;
    const next = getNextStep(routeIndex);
    if (!next) {
      els.maneuverChip.textContent = "next turn: route inactive";
      return;
    }
    const feet = state.lastPosition ? distanceFeet(state.lastPosition.lat, state.lastPosition.lng, next.latlng[0], next.latlng[1]) : next.distance * 3.28084;
    els.maneuverChip.textContent = `${formatDistance(feet)}: ${next.instruction}`;
  }

  function maybeAnnounceNextManeuver(routeIndex) {
    const next = getNextStep(routeIndex);
    if (!next || state.spokenStepIds.has(next.id)) return;
    const feet = distanceFeet(state.lastPosition.lat, state.lastPosition.lng, next.latlng[0], next.latlng[1]);
    const isArrival = next.instruction.toLowerCase().includes("arrive");
    if (feet > (isArrival ? 350 : 950)) return;
    state.spokenStepIds.add(next.id);
    enqueueSpeech(`In ${formatDistanceSpeech(feet)}, ${next.instruction}.`, "direction");
  }

  function maybeAnnounceStreet(routeIndex) {
    const current = getCurrentStep(routeIndex);
    const street = current?.name?.trim();
    const now = Date.now();
    if (!street || street === state.lastStreetName || now - state.lastStreetAnnounceAt < 30000) return;
    state.lastStreetName = street;
    state.lastStreetAnnounceAt = now;
    enqueueSpeech(`Continue on ${street}.`, "direction");
  }

  function maybeAnnounceEta(remainingSeconds) {
    const now = Date.now();
    if (!state.routeEtaAnnounceInterval || now - state.lastEtaAnnounceAt < state.routeEtaAnnounceInterval) return;
    state.lastEtaAnnounceAt = now;
    enqueueSpeech(`Updated ETA is ${formatDurationSpeech(remainingSeconds)}.`, "eta");
  }

  function maybeAnnounceCameraAlert() {
    const now = Date.now();
    if (now - state.lastCameraAlertAt < 12000) return;
    const camera = getNearestAlertCamera();
    if (!camera) return;

    const thresholds = [50, 100, 1320, 2640, 5280];
    for (const threshold of thresholds) {
      if (camera.feet > threshold) continue;
      const key = `${camera.cam.id}:${threshold}`;
      if (state.cameraAlertHistory.has(key)) continue;
      state.cameraAlertHistory.add(key);
      state.lastCameraAlertAt = now;
      enqueueSpeech(`Flock camera ${formatDistanceSpeech(camera.feet)} ahead.`, "camera");
      return;
    }
  }

  function getNearestAlertCamera() {
    if (!state.lastPosition || !state.cameras.length) return null;
    let best = null;
    let bestFeet = Infinity;
    const routeOnly = state.routeCameraIds.size > 0;

    for (const cam of state.cameras) {
      if (routeOnly && !state.routeCameraIds.has(cam.id)) continue;
      if (!(cam.brand || "").toLowerCase().includes("flock")) continue;
      const feet = distanceFeet(state.lastPosition.lat, state.lastPosition.lng, cam.lat, cam.lng);
      if (feet < bestFeet) {
        best = cam;
        bestFeet = feet;
      }
    }

    if (!best || bestFeet > 5280) return null;
    return { cam: best, feet: bestFeet };
  }

  function getNextStep(routeIndex) {
    return state.routeSteps.find((step) => step.routeIndex >= routeIndex && step.instruction && !step.instruction.toLowerCase().startsWith("start"));
  }

  function getCurrentStep(routeIndex) {
    let current = null;
    for (const step of state.routeSteps) {
      if (step.routeIndex > routeIndex) break;
      current = step;
    }
    return current;
  }

  function findClosestRouteIndex(lat, lng, routeLatLngs) {
    if (!routeLatLngs.length) return 0;
    let bestIndex = 0;
    let bestFeet = Infinity;
    for (let i = 0; i < routeLatLngs.length; i += 1) {
      const point = routeLatLngs[i];
      const feet = distanceFeet(lat, lng, point[0], point[1]);
      if (feet < bestFeet) {
        bestFeet = feet;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function enqueueSpeech(text, type = "info") {
    if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) return;
    if (!state.speechUnlocked || !state.speechEnabled) {
      els.runtimeLabel.textContent = "tap Voice for alerts";
      return;
    }
    const item = { text, type };
    if (type === "direction") {
      const firstNonDirection = state.speechQueue.findIndex((queued) => queued.type !== "direction");
      if (firstNonDirection === -1) state.speechQueue.push(item);
      else state.speechQueue.splice(firstNonDirection, 0, item);
    } else {
      state.speechQueue.push(item);
    }
    speakNext();
  }

  function toggleVoiceAlerts() {
    if (state.speechEnabled) {
      state.speechEnabled = false;
      state.speechQueue = [];
      state.speechSpeaking = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      updateVoiceButton();
      els.runtimeLabel.textContent = "voice alerts off";
      return;
    }

    unlockSpeech(true);
  }

  function unlockSpeech(announce = false) {
    if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
      els.runtimeLabel.textContent = "voice unavailable";
      return false;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(announce ? "Voice alerts on." : " ");
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = announce ? 1 : 0.01;
      utterance.onend = () => {
        state.speechSpeaking = false;
      };
      utterance.onerror = () => {
        state.speechSpeaking = false;
      };
      state.speechUnlocked = true;
      state.speechEnabled = true;
      state.speechSpeaking = true;
      window.speechSynthesis.speak(utterance);
      updateVoiceButton();
      els.runtimeLabel.textContent = "voice alerts on";
      return true;
    } catch (error) {
      console.warn("Voice unlock failed:", error);
      els.runtimeLabel.textContent = "voice blocked";
      return false;
    }
  }

  function updateVoiceButton() {
    if (!els.voiceBtn) return;

    if (!state.speechUnlocked) {
      els.voiceBtn.textContent = "Voice";
      els.voiceBtn.classList.remove("following");
      els.voiceBtn.classList.remove("voice-off");
      els.voiceBtn.setAttribute("aria-pressed", "false");
      return;
    }

    els.voiceBtn.textContent = state.speechEnabled ? "Voice On" : "Voice Off";
    els.voiceBtn.classList.toggle("following", state.speechEnabled);
    els.voiceBtn.classList.toggle("voice-off", !state.speechEnabled);
    els.voiceBtn.setAttribute("aria-pressed", state.speechEnabled ? "true" : "false");
  }

  function speakNext() {
    if (state.speechSpeaking || !state.speechQueue.length || !("speechSynthesis" in window)) return;
    const item = state.speechQueue.shift();
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.rate = item.type === "direction" ? 0.95 : 0.92;
    utterance.pitch = 1;
    utterance.onend = () => {
      state.speechSpeaking = false;
      speakNext();
    };
    utterance.onerror = () => {
      state.speechSpeaking = false;
      speakNext();
    };
    state.speechSpeaking = true;
    window.speechSynthesis.speak(utterance);
  }

  function getCamerasNearRoute(routeLatLngs, thresholdFeet) {
    if (!routeLatLngs.length || !state.cameras.length) return [];
    const routeBounds = L.latLngBounds(routeLatLngs).pad(0.08);
    const candidates = [];

    for (const cam of state.cameras) {
      if (!routeBounds.contains([cam.lat, cam.lng])) continue;
      const feet = distanceToRouteFeet(cam.lat, cam.lng, routeLatLngs);
      if (feet <= thresholdFeet) candidates.push({ cam, feet });
    }

    return candidates.sort((a, b) => a.feet - b.feet);
  }

  function distanceToRouteFeet(lat, lng, routeLatLngs) {
    let best = Infinity;
    for (let i = 1; i < routeLatLngs.length; i += 1) {
      const distance = distancePointToSegmentFeet(lat, lng, routeLatLngs[i - 1], routeLatLngs[i]);
      if (distance < best) best = distance;
    }
    return best;
  }

  function distancePointToSegmentFeet(lat, lng, a, b) {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((lat * Math.PI) / 180);
    const px = 0;
    const py = 0;
    const ax = (a[1] - lng) * metersPerDegreeLng;
    const ay = (a[0] - lat) * metersPerDegreeLat;
    const bx = (b[1] - lng) * metersPerDegreeLng;
    const by = (b[0] - lat) * metersPerDegreeLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (!lengthSq) return Math.sqrt(ax * ax + ay * ay) * 3.28084;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    const x = ax + t * dx;
    const y = ay + t * dy;
    return Math.sqrt(x * x + y * y) * 3.28084;
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

  function formatDistanceSpeech(feet) {
    if (!Number.isFinite(feet)) return "nearby";
    if (feet <= 75) return `${Math.round(feet)} feet`;
    if (feet < 1000) return `${Math.round(feet / 50) * 50} feet`;
    const miles = feet / 5280;
    return `${miles.toFixed(miles < 1 ? 2 : 1)} miles`;
  }

  function formatDurationShort(seconds) {
    if (!Number.isFinite(seconds)) return "--";
    const minutes = Math.max(0, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  function formatDurationSpeech(seconds) {
    if (!Number.isFinite(seconds)) return "unknown";
    const minutes = Math.max(0, Math.round(seconds / 60));
    if (minutes < 1) return "less than one minute";
    if (minutes === 1) return "one minute";
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (!mins) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
    return `${hours} ${hours === 1 ? "hour" : "hours"} and ${mins} minutes`;
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
