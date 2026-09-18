/* global defra, history, MutationObserver */

import { daqiBand, daqiMarkerOptions, toSafeDaqiIndex } from './map-daqi.js'
import {
  escapeHtml,
  formatDate,
  NOT_AVAILABLE,
  pollutantLabels,
  stationStatusTag
} from './map-utils.js'
import {
  stationMatchesFilter,
  isActiveStation,
  initFilterPanel,
  filterState
} from './map-filter-panel.js'

const defaultZoom = 5.4842222
const ukCentreLng = -1.4649
const ukCentreLat = 52.5619

const ARIA_PRESSED = 'aria-pressed'
const TAB_ACTIVE_CLASS = 'aq-filter-panel__tab--active'

// Maximum distance (degrees) between a station and a forecast point to be considered a match.
const FORECAST_MATCH_RADIUS_DEG = 0.05

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Maximum squared distance (degrees²) for a map click to select a station (~11 km at mid zoom).
const CLICK_SELECT_MAX_SQUARED_DEG = 0.01

const MAP_KEY_OVERLAY_ID = 'map-key-overlay'
const keyButtonElement = document.getElementById('key-button')
const stationPanelElement = document.getElementById('station-panel')

/**
 * Returns today's DAQI value from a forecast entry.
 *
 * The forecast array contains values for each day of the week (e.g. Mon–Fri).
 * Rather than assuming index 0 is always today — which breaks if the nightly
 * refresh cron job hasn't run yet and the stored data is from the previous day
 * — we match by the current day abbreviation instead.
 *
 * Falls back to index 0 if no matching day entry is found.
 *
 * @param {{ forecast: Array<{ day: string, value: number }> }} forecastEntry
 * @param {string} dayAbbr - Three-letter day abbreviation e.g. 'Mon'
 * @returns {number}
 */
function daqiValueForDay(forecastEntry, dayAbbr) {
  const entry =
    forecastEntry.forecast.find((f) => f.day === dayAbbr) ??
    forecastEntry.forecast[0]
  return entry.value
}

const map = new defra.InteractiveMap('map', {
  mapProvider: defra.maplibreProvider(),
  behaviour: 'hybrid',
  mapLabel: 'United Kingdom',
  zoom: defaultZoom,
  center: [ukCentreLng, ukCentreLat],
  containerHeight: '100%',
  mapStyle: {
    url: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: 'OpenFreeMap \u00a9 OpenMapTiles Data from OpenStreetMap',
    backgroundColor: '#f5f5f0'
  }
})

/**
 * Returns the marker id for a station.
 * @param {{ localSiteID: string }} station
 * @returns {string}
 */
function stationMarkerId(station) {
  return `ms-${station.localSiteID}`
}

/**
 * Converts API coordinates [lat, lng] to the [lng, lat] order the map expects.
 * @param {{ location: { coordinates: [number, number] } }} station
 * @returns {[number, number]}
 */
function stationMapCoords(station) {
  const coords = station.location.coordinates
  return [Number.parseFloat(coords[1]), Number.parseFloat(coords[0])]
}

/**
 * Returns true only when a station has a plottable coordinate pair.
 * Stations missing location data or with non-finite values are skipped.
 * @param {{ location?: { coordinates?: unknown } }} station
 * @returns {boolean}
 */
function hasValidCoords(station) {
  const coords = station.location?.coordinates
  if (!Array.isArray(coords) || coords.length !== 2) {
    return false
  }
  if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
    return false
  }
  return true
}

let sortedStationsByLat = []
try {
  const response = await fetch('/api/monitoring-stations')
  if (response.ok) {
    const data = await response.json()
    sortedStationsByLat = (data.stations ?? []).sort((stationA, stationB) => {
      const latA = Number.parseFloat(stationA.location?.coordinates?.[0]) || 0
      const latB = Number.parseFloat(stationB.location?.coordinates?.[0]) || 0
      return latB - latA
    })
  }
} catch (err) {
  console.warn('Failed to load monitoring stations', err)
}

let forecasts = []
try {
  const forecastResponse = await fetch('/api/forecasts')
  if (forecastResponse.ok) {
    const forecastData = await forecastResponse.json()
    forecasts = Array.isArray(forecastData)
      ? forecastData
      : (forecastData.forecasts ?? [])
  }
} catch (err) {
  console.warn('Failed to load forecasts', err)
}

/** DAQI index keyed by localSiteID for AURN observed mode. */
const aurnDataByStation = new Map()
try {
  const aurnResponse = await fetch('/api/aurn-data')
  if (aurnResponse.ok) {
    const aurnData = await aurnResponse.json()
    for (const m of aurnData.measurements ?? []) {
      aurnDataByStation.set(m.localSiteID, m.daqiIndex)
    }
  }
} catch (err) {
  console.warn('Failed to load AURN data', err)
}

/** The currently selected forecast day abbreviation (e.g. 'Mon'). Defaults to today. */
let selectedForecastDay = DAY_ABBR[new Date().getDay()]

/**
 * Finds the forecast entry whose location is nearest to the station, within 0.05 degrees.
 * @param {{ location: { coordinates: [number, number] } }} station
 * @returns {object|null}
 */
function forecastForStation(station) {
  if (!station.location) {
    return null
  }
  const sLat = Number.parseFloat(station.location.coordinates[0])
  const sLng = Number.parseFloat(station.location.coordinates[1])
  let best = null
  let bestDist = FORECAST_MATCH_RADIUS_DEG * FORECAST_MATCH_RADIUS_DEG
  forecasts.forEach((entry) => {
    if (!entry.location?.coordinates) {
      return
    }
    const fLat = Number.parseFloat(entry.location.coordinates[0])
    const fLng = Number.parseFloat(entry.location.coordinates[1])
    const dist = (fLat - sLat) ** 2 + (fLng - sLng) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = entry
    }
  })
  return best
}

/**
 * Returns today's DAQI value (1–10) for a station, or null if unavailable.
 * In AURN mode, returns the observed DAQI from the aurnDataByStation map.
 * In forecast mode, returns the forecast DAQI for the selected day.
 * Closed stations always return null.
 * @param {{ stationStatus?: string, status?: string, siteStatus?: string, localSiteID?: string }} station
 * @returns {number|null}
 */
function stationDaqi(station) {
  const status = (
    station.stationStatus ||
    station.status ||
    station.siteStatus ||
    ''
  ).toLowerCase()
  if (status === 'closed') {
    return null
  }
  if (filterState.mapMode === 'aurn') {
    return toSafeDaqiIndex(aurnDataByStation.get(station.localSiteID))
  }
  const forecast = forecastForStation(station)
  if (
    forecast &&
    Array.isArray(forecast.forecast) &&
    forecast.forecast.length > 0
  ) {
    return toSafeDaqiIndex(daqiValueForDay(forecast, selectedForecastDay))
  }
  return null
}

// Whether the user manually closed the key overlay (prevents auto-reopen on panel close).
let keyClosedByUser = false

/**
 * Shows the map key overlay.
 */
function showKeyOverlay() {
  const overlay = document.getElementById(MAP_KEY_OVERLAY_ID)
  if (overlay) {
    overlay.hidden = false
  }
  keyButtonElement?.setAttribute('aria-expanded', 'true')
}

/**
 * Hides the map key overlay.
 * @param {boolean} byUser - true when the user explicitly dismissed it
 */
function hideKeyOverlay(byUser) {
  const overlay = document.getElementById(MAP_KEY_OVERLAY_ID)
  if (overlay) {
    overlay.hidden = true
  }
  keyButtonElement?.setAttribute('aria-expanded', 'false')
  if (byUser) {
    keyClosedByUser = true
  }
}

/**
 * Wires up the map key close button.
 */
function initKeyOverlay() {
  document.getElementById('map-key-close')?.addEventListener('click', () => {
    hideKeyOverlay(true)
  })
}

/**
 * Wires up the Key toggle button in the reopen stack.
 */
function initReopenStack() {
  keyButtonElement?.addEventListener('click', () => {
    const overlay = document.getElementById(MAP_KEY_OVERLAY_ID)
    if (overlay?.hidden) {
      keyClosedByUser = false
      showKeyOverlay()
    } else {
      hideKeyOverlay(true)
    }
  })
}

/**
 * Wires up keyboard interaction for the station information panel.
 * Closes the panel when Escape is pressed.
 */
function initStationPanelKeyboard() {
  stationPanelElement?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeStationPanel()
    }
  })
}

/**
 * Patches a marker SVG element with the attributes needed for keyboard access.
 * The Defra InteractiveMap component renders each marker as an
 * <svg id="map-marker-{id}" role="img"> element with no tabindex, so keyboard
 * users cannot reach or activate markers without this patch.
 * Uses a data attribute to skip re-initialisation when the same DOM element
 * has its SVG content updated by a later addMarker call.
 * @param {string} markerId - the marker id passed to map.addMarker (e.g. "ms-UKA001")
 * @param {{ name?: string }} station
 */
function makeMarkerKeyboardAccessible(markerId, station) {
  const el = document.getElementById(`map-marker-${markerId}`)
  if (!el || el.dataset.keyboardInit) {
    return
  }
  el.setAttribute('tabindex', '0')
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', station.name ?? 'Monitoring station')
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      highlightStation(station)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      const filterPanel = document.getElementById('filter-panel')
      if (filterPanel && !filterPanel.hidden) {
        document.getElementById('filter-panel-close')?.focus()
      } else {
        document.getElementById('filter-button')?.focus()
      }
    }
  })
  el.dataset.keyboardInit = 'true'
}

/**
 * Watches the marker container for new elements and patches each one via
 * makeMarkerKeyboardAccessible as soon as it appears.
 * This is necessary because the Defra InteractiveMap component creates marker
 * DOM elements asynchronously — calling document.getElementById() immediately
 * after map.addMarker() would find nothing.
 * In the test environment, .im-c-viewport__markers does not exist, so we fall
 * back to observing #map directly.
 */
function initMarkerObserver() {
  const container =
    document.querySelector('.im-c-viewport__markers') ??
    document.getElementById('map')
  if (!container) {
    return
  }

  const markerObserver = new MutationObserver((mutations) => {
    const addedMarkers = mutations.flatMap((mutation) =>
      Array.from(mutation.addedNodes)
    )
    addedMarkers.forEach((markerEl) => {
      if (markerEl.nodeType !== 1) {
        return // Node.ELEMENT_NODE
      }
      const markerId = markerEl.id?.replace('map-marker-', '')
      if (!markerId || markerEl.id === markerId) {
        return
      }
      const station = sortedStationsByLat.find(
        (s) => stationMarkerId(s) === markerId
      )
      if (station) {
        makeMarkerKeyboardAccessible(markerId, station)
      }
    })
  })

  markerObserver.observe(container, { childList: true })
}

/**
 * Restores mouse-panning mode when the user initiates a mouse interaction on
 * the map after keyboard-navigating to a marker.
 * The Defra InteractiveMap component switches to keyboard mode whenever a
 * focusable element within it has focus, disabling mouse pan. A single
 * mousedown listener on the map container blurs any focused marker, which
 * returns the component to its normal mouse-panning state.
 */
function initMapMouseInteraction() {
  document.getElementById('map')?.addEventListener('mousedown', () => {
    if (document.activeElement?.dataset.keyboardInit) {
      document.activeElement.blur()
    }
  })
}

/**
 * Populates the forecast day selector buttons from the loaded forecasts data.
 * The button matching today's day abbreviation is activated by default.
 * Selecting a day updates selectedForecastDay and re-plots all markers.
 * @param {Function} onDayChange - called to re-plot markers when the day changes
 */
function initForecastDayControls(onDayChange) {
  const dayGroup = document.getElementById('forecast-day-group')
  if (!dayGroup || forecasts.length === 0) {
    return
  }
  const days = forecasts[0]?.forecast?.map((f) => f.day) ?? []
  days.forEach((day) => {
    const btn = document.createElement('button')
    const isActive = day === selectedForecastDay
    btn.className =
      'aq-filter-panel__tab' + (isActive ? ` ${TAB_ACTIVE_CLASS}` : '')
    btn.setAttribute(ARIA_PRESSED, String(isActive))
    btn.dataset.day = day
    btn.innerHTML = `<span>${day}</span>`
    btn.addEventListener('click', () => {
      dayGroup.querySelectorAll('button').forEach((b) => {
        b.setAttribute(ARIA_PRESSED, 'false')
        b.classList.remove(TAB_ACTIVE_CLASS)
      })
      btn.setAttribute(ARIA_PRESSED, 'true')
      btn.classList.add(TAB_ACTIVE_CLASS)
      selectedForecastDay = day
      onDayChange()
    })
    dayGroup.appendChild(btn)
  })
}

/**
 * (Re)plots all markers that pass the current filter, removing any that no longer match.
 * Sorted north-to-south, then lowest-DAQI first within each latitude so that the
 * highest-DAQI marker is added last and renders on top.
 */
function plotAllMarkers() {
  const sortByLatThenDaqi = [...sortedStationsByLat].sort((a, b) => {
    const latA = Number.parseFloat(a.location?.coordinates?.[0]) || 0
    const latB = Number.parseFloat(b.location?.coordinates?.[0]) || 0
    if (latA !== latB) {
      return latB - latA
    }
    const daqiA = stationDaqi(a) ?? 0
    const daqiB = stationDaqi(b) ?? 0
    return daqiA - daqiB
  })
  sortByLatThenDaqi.forEach((station) => {
    if (!hasValidCoords(station)) {
      return
    }
    const id = stationMarkerId(station)
    if (id === selectedMarkerId) {
      return
    }
    if (stationMatchesFilter(station)) {
      map.addMarker(
        id,
        stationMapCoords(station),
        daqiMarkerOptions(stationDaqi(station), false)
      )
    } else {
      map.removeMarker(id)
    }
  })
}

// Plot all station markers and initialise map UI on first render.
map.on('map:firstidle', () => {
  initKeyOverlay()
  initReopenStack()
  initStationPanelKeyboard()
  initMarkerObserver()
  initMapMouseInteraction()
  plotAllMarkers()
  initFilterPanel(plotAllMarkers)
  initForecastDayControls(plotAllMarkers)
  document.getElementById('exit-map')?.addEventListener('click', () => {
    history.back()
  })
})

/**
 * Builds the DAQI detail row for the station panel, or null if unavailable.
 * @param {object} station
 * @returns {Array|null}
 */
/**
 * Builds a DAQI tag span for use in the station panel.
 * @param {number} daqiValue
 * @returns {string}
 */
function buildDaqiTag(daqiValue) {
  const band = daqiBand[daqiValue] || ''
  const bandKey = band.toLowerCase().replaceAll(' ', '')
  const daqiClass = bandKey
    ? `aq-daqi-tag aq-daqi-tag--${bandKey}`
    : 'aq-daqi-tag'
  const bandSuffix = band ? ` (${band.toLowerCase()})` : ''

  return `<span class="${daqiClass}">${daqiValue}${bandSuffix}</span>`
}

function buildDaqiRow(station) {
  if (filterState.mapMode === 'aurn') {
    const aurnDaqi = toSafeDaqiIndex(aurnDataByStation.get(station.localSiteID))
    if (aurnDaqi == null) {
      return ['DAQI (observed)', NOT_AVAILABLE]
    }
    return ['DAQI (observed)', buildDaqiTag(aurnDaqi), true]
  }
  const forecast = forecastForStation(station)
  if (
    !forecast ||
    !Array.isArray(forecast.forecast) ||
    forecast.forecast.length === 0
  ) {
    return null
  }
  const forecastDaqi = toSafeDaqiIndex(
    daqiValueForDay(forecast, selectedForecastDay)
  )
  if (forecastDaqi == null) {
    return ['DAQI (forecast)', NOT_AVAILABLE]
  }
  return ['DAQI (forecast)', buildDaqiTag(forecastDaqi), true]
}

/**
 * Builds the rows array for the station details definition list.
 * @param {object} station
 * @param {boolean} isClosed
 * @returns {Array}
 */
function buildPanelRows(station, isClosed) {
  const rows = []

  const pollutants = station.pollutants || []
  if (pollutants.length > 0) {
    const seen = []
    pollutants.forEach((code) => {
      const label = pollutantLabels[code] || code
      if (!seen.includes(label)) {
        seen.push(label)
      }
    })
    rows.push(['Pollutants', seen.join(', ')])
  }

  if (!isClosed) {
    const daqiRow = buildDaqiRow(station)
    if (daqiRow) {
      rows.push(daqiRow)
    }
  }

  rows.push(['Local authority', station.localAuthority || NOT_AVAILABLE])
  if (station.areaType) {
    rows.push(['Site type', station.areaType])
  }
  rows.push([
    'Start date',
    station.openDate ? formatDate(station.openDate) : NOT_AVAILABLE
  ])
  const endDate = station.closeDate
    ? formatDate(station.closeDate)
    : NOT_AVAILABLE
  if (isClosed) {
    rows.push(['End date', endDate])
  }

  return rows
}

/**
 * Populates and shows the station panel for the given station.
 * @param {{ name?: string, stationStatus?: string, status?: string, siteStatus?: string,
 *   pollutants?: string[], localAuthority?: string, areaType?: string,
 *   openDate?: string, closeDate?: string }} station
 */
function showStationPanel(station) {
  if (!stationPanelElement?.isConnected) {
    return
  }

  const status = (
    station.stationStatus ||
    station.status ||
    station.siteStatus ||
    ''
  ).toLowerCase()
  const isClosed = status === 'closed'

  document.getElementById('sp-name').innerHTML =
    escapeHtml(station.name || '') + stationStatusTag(status, isClosed)

  document.getElementById('sp-details').innerHTML = buildPanelRows(
    station,
    isClosed
  )
    .map(
      ([label, value, isHtml]) =>
        `<div class="aq-station-info-row"><dt>${escapeHtml(label)}:</dt> <dd>${isHtml ? value : escapeHtml(String(value))}</dd></div>`
    )
    .join('')

  panelTrigger = document.activeElement
  stationPanelElement.classList.add('visible')
  hideKeyOverlay(false)
  stationPanelElement.focus()
}

let selectedMarkerId = null
let panelTrigger = null

/**
 * Restores the previously selected marker to its DAQI colour and hides the station panel.
 */
function closeStationPanel() {
  if (stationPanelElement) {
    stationPanelElement.classList.remove('visible')
  }
  if (selectedMarkerId) {
    const prev = sortedStationsByLat.find(
      (s) => stationMarkerId(s) === selectedMarkerId
    )
    if (prev) {
      map.addMarker(
        selectedMarkerId,
        stationMapCoords(prev),
        daqiMarkerOptions(stationDaqi(prev), false)
      )
    }
    selectedMarkerId = null
  }
  if (!keyClosedByUser) {
    showKeyOverlay()
  }
  panelTrigger?.focus()
  panelTrigger = null
}

/**
 * Selects a station: restores the previous marker, highlights the new one, and shows the panel.
 * @param {object} station
 */
function highlightStation(station) {
  if (selectedMarkerId) {
    const prev = sortedStationsByLat.find(
      (s) => stationMarkerId(s) === selectedMarkerId
    )
    if (prev) {
      map.addMarker(
        selectedMarkerId,
        stationMapCoords(prev),
        daqiMarkerOptions(stationDaqi(prev), false)
      )
    }
  }
  selectedMarkerId = stationMarkerId(station)
  map.addMarker(
    selectedMarkerId,
    stationMapCoords(station),
    daqiMarkerOptions(stationDaqi(station), true)
  )
  showStationPanel(station)
}

// On map click (canvas), find the nearest plotted station within ~11 km (0.1°) and select it.
// Note: clicking directly on a station marker (DOM overlay) does not fire map:click —
// that case is handled by the delegated listener below.
map.on('map:click', (evt) => {
  if (!evt?.coords) {
    return
  }
  const [clickLng, clickLat] = evt.coords
  let best = null
  let bestDist = Infinity
  sortedStationsByLat.forEach((station) => {
    if (!hasValidCoords(station) || !isActiveStation(station)) {
      return
    }
    const lat = Number.parseFloat(station.location.coordinates[0])
    const lng = Number.parseFloat(station.location.coordinates[1])
    const squaredDist = (lng - clickLng) ** 2 + (lat - clickLat) ** 2
    if (squaredDist < bestDist) {
      bestDist = squaredDist
      best = station
    }
  })
  // sqrt(CLICK_SELECT_MAX_SQUARED_DEG) ≈ 0.1 degrees ≈ 11 km — reasonable click target at mid zoom
  if (best && bestDist < CLICK_SELECT_MAX_SQUARED_DEG) {
    highlightStation(best)
  }
})

/**
 * Navigates the map to a station: highlights it and shows the station panel.
 * Exposed on window so station-list.js can trigger map navigation.
 * @param {object} station
 */
globalThis.navigateToStation = function (station) {
  highlightStation(station)
}

document
  .getElementById('sp-close')
  ?.addEventListener('click', closeStationPanel)

export { map }
