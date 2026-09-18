const ARIA_PRESSED = 'aria-pressed'
const TAB_ACTIVE_CLASS = 'aq-filter-panel__tab--active'

const filterState = {
  mode: 'daqi',
  mapMode: 'aurn',
  selected: new Set(['NO2', 'O3', 'SO2', 'PM25', 'PM10'])
}

const ACTIVE_STATUSES = new Set(['', 'current', 'active'])

/**
 * Returns true if the station is open (not closed/inactive).
 * @param {object} station
 * @returns {boolean}
 */
function isActiveStation(station) {
  const stationStatus = (
    station.stationStatus ||
    station.status ||
    station.siteStatus ||
    ''
  ).toLowerCase()
  return ACTIVE_STATUSES.has(stationStatus)
}

/**
 * Returns true if the station should be plotted on the map.
 * Closed and inactive stations are always excluded.
 * Stations with no pollutant data are always included (data may not have loaded yet).
 * @param {object} station
 * @returns {boolean}
 */
function stationMatchesFilter(station) {
  if (!isActiveStation(station)) {
    return false
  }
  if (filterState.mode === 'other') {
    return true
  }
  if (filterState.selected.size === 0) {
    return false
  }
  const pollutants = station.pollutants || []
  if (pollutants.length === 0) {
    return true
  }
  return pollutants.some((code) => filterState.selected.has(code))
}

/**
 * Wires up the filter panel tabs, checkboxes and open/close behaviour.
 * The HTML for the panel content is pre-rendered server-side by Nunjucks;
 * this function only shows, hides and reads DOM state.
 * @param {Function} onFilterChange - called to re-plot markers when the filter changes
 */
/**
 * Collapses the filter panel and updates the toggle button state.
 * @param {HTMLElement} panel
 * @param {HTMLElement} reopenBtn
 */
function closeFilterPanel(panel, reopenBtn) {
  panel.hidden = true
  reopenBtn.setAttribute('aria-expanded', 'false')
  reopenBtn.focus()
}

/**
 * Expands the filter panel and updates the toggle button state.
 * @param {HTMLElement} panel
 * @param {HTMLElement} reopenBtn
 */
function openFilterPanel(panel, reopenBtn) {
  panel.hidden = false
  reopenBtn.setAttribute('aria-expanded', 'true')
  panel.focus()
}

/**
 * Wires up the panel open/close button behaviour.
 */
function initPanelOpenClose(panel, reopenBtn) {
  document
    .getElementById('filter-panel-close')
    .addEventListener('click', () => closeFilterPanel(panel, reopenBtn))
  reopenBtn?.addEventListener('click', () => {
    if (panel.hidden) {
      openFilterPanel(panel, reopenBtn)
    } else {
      closeFilterPanel(panel, reopenBtn)
    }
  })
}

/**
 * Wires up the Monitoring stations / Forecast map type toggle.
 */
function initMapTypeToggle(
  mapTypeAurn,
  mapTypeForecast,
  pollutantControls,
  forecastDayControls,
  onFilterChange
) {
  mapTypeAurn?.addEventListener('click', () => {
    filterState.mapMode = 'aurn'
    mapTypeAurn.setAttribute(ARIA_PRESSED, 'true')
    mapTypeForecast?.setAttribute(ARIA_PRESSED, 'false')
    mapTypeAurn.classList.add(TAB_ACTIVE_CLASS)
    mapTypeForecast?.classList.remove(TAB_ACTIVE_CLASS)
    if (pollutantControls) {
      pollutantControls.hidden = false
    }
    if (forecastDayControls) {
      forecastDayControls.hidden = true
    }
    onFilterChange()
  })

  mapTypeForecast?.addEventListener('click', () => {
    filterState.mapMode = 'forecast'
    mapTypeForecast.setAttribute(ARIA_PRESSED, 'true')
    mapTypeAurn?.setAttribute(ARIA_PRESSED, 'false')
    mapTypeForecast.classList.add(TAB_ACTIVE_CLASS)
    mapTypeAurn?.classList.remove(TAB_ACTIVE_CLASS)
    if (pollutantControls) {
      pollutantControls.hidden = true
    }
    if (forecastDayControls) {
      forecastDayControls.hidden = false
    }
    onFilterChange()
  })
}

/**
 * Wires up the DAQI pollutants / Other pollutants tab pair.
 */
function initPollutantTabs(
  tabDaqi,
  tabOther,
  daqiContent,
  otherContent,
  onFilterChange
) {
  tabDaqi.addEventListener('click', () => {
    filterState.mode = 'daqi'
    tabDaqi.setAttribute(ARIA_PRESSED, 'true')
    tabOther.setAttribute(ARIA_PRESSED, 'false')
    if (daqiContent) {
      daqiContent.hidden = false
    }
    if (otherContent) {
      otherContent.hidden = true
    }
    onFilterChange()
  })
  tabOther.addEventListener('click', () => {
    filterState.mode = 'other'
    tabOther.setAttribute(ARIA_PRESSED, 'true')
    tabDaqi.setAttribute(ARIA_PRESSED, 'false')
    if (daqiContent) {
      daqiContent.hidden = true
    }
    if (otherContent) {
      otherContent.hidden = false
    }
    onFilterChange()
  })
}

/**
 * Wires up the pollutant checkboxes and show-inactive toggle.
 */
function initPollutantCheckboxes(onFilterChange) {
  const scroll = document.querySelector('.aq-filter-panel__scroll')
  if (!scroll) {
    return
  }
  scroll.addEventListener('change', (event) => {
    if (event.target?.type !== 'checkbox') {
      return
    }
    const codes = event.target.value.split(',')
    if (event.target.checked) {
      codes.forEach((code) => filterState.selected.add(code))
    } else {
      codes.forEach((code) => filterState.selected.delete(code))
    }
    onFilterChange()
  })
}

/**
 * Wires up the filter panel tabs, checkboxes and open/close behaviour.
 * The HTML for the panel content is pre-rendered server-side by Nunjucks;
 * this function only shows, hides and reads DOM state.
 * @param {Function} onFilterChange - called to re-plot markers when the filter changes
 */
function initFilterPanel(onFilterChange) {
  const panel = document.getElementById('filter-panel')
  if (!panel) {
    return
  }
  const reopenBtn = document.getElementById('filter-button')
  initPanelOpenClose(panel, reopenBtn)
  initMapTypeToggle(
    document.getElementById('map-type-aurn'),
    document.getElementById('map-type-forecast'),
    document.getElementById('pollutant-filter-controls'),
    document.getElementById('forecast-day-controls'),
    onFilterChange
  )
  initPollutantTabs(
    document.getElementById('filter-tab-daqi'),
    document.getElementById('filter-tab-other'),
    document.getElementById('filter-daqi-content'),
    document.getElementById('filter-other-content'),
    onFilterChange
  )
  initPollutantCheckboxes(onFilterChange)
}

export { filterState, stationMatchesFilter, isActiveStation, initFilterPanel }
