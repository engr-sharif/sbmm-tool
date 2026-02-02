/**
 * SBMM Planning Tool - Search & Filter Module
 *
 * Search bar for finding samples by ID, and filter panel for
 * filtering by analyte thresholds, exceedances, and data source.
 */
var SearchModule = (function() {
    'use strict';

    var activeFilters = {
        text: '',
        source: 'all',         // 'all', '2025', 'ea'
        exceedance: 'all',     // 'all', 'exceeds', 'below'
        analyte: 'any',        // 'any', 'Mercury', 'Arsenic', etc.
        minValue: null,
        maxValue: null
    };

    /**
     * Initialize search and filter UI events.
     */
    function init() {
        var searchInput = document.getElementById('searchInput');
        if (!searchInput) return;

        searchInput.addEventListener('input', function() {
            activeFilters.text = this.value.trim().toLowerCase();
            applyFilters();
        });

        // Clear button
        var clearBtn = document.getElementById('searchClear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                searchInput.value = '';
                activeFilters.text = '';
                applyFilters();
            });
        }

        // Filter controls
        var sourceFilter = document.getElementById('filterSource');
        if (sourceFilter) {
            sourceFilter.addEventListener('change', function() {
                activeFilters.source = this.value;
                applyFilters();
            });
        }

        var exceedFilter = document.getElementById('filterExceedance');
        if (exceedFilter) {
            exceedFilter.addEventListener('change', function() {
                activeFilters.exceedance = this.value;
                applyFilters();
            });
        }

        var analyteFilter = document.getElementById('filterAnalyte');
        if (analyteFilter) {
            analyteFilter.addEventListener('change', function() {
                activeFilters.analyte = this.value;
                applyFilters();
            });
        }

        var minFilter = document.getElementById('filterMinValue');
        if (minFilter) {
            minFilter.addEventListener('input', function() {
                activeFilters.minValue = this.value ? parseFloat(this.value) : null;
                applyFilters();
            });
        }

        var maxFilter = document.getElementById('filterMaxValue');
        if (maxFilter) {
            maxFilter.addEventListener('input', function() {
                activeFilters.maxValue = this.value ? parseFloat(this.value) : null;
                applyFilters();
            });
        }

        var resetBtn = document.getElementById('filterReset');
        if (resetBtn) {
            resetBtn.addEventListener('click', resetFilters);
        }

        // Toggle filter panel
        var toggleBtn = document.getElementById('filterToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function() {
                var panel = document.getElementById('filterPanel');
                if (panel) {
                    panel.classList.toggle('visible');
                    this.classList.toggle('active');
                }
            });
        }
    }

    /**
     * Apply all active filters to the sample lists and map markers.
     */
    function applyFilters() {
        var data = AppState.data;
        var matchCount = 0;

        // Filter 2025 samples
        data.samples2025.forEach(function(s) {
            var visible = matchesSample(s, '2025');
            var listItem = document.querySelector('.sample-item[data-type="2025"][data-id="' + s.num + '"]');
            if (listItem) listItem.style.display = visible ? '' : 'none';

            // Update map marker visibility
            var marker = AppState.markers2025[s.num];
            if (marker) {
                if (visible) {
                    if (s.sampled && AppState.layers.sampled2025.hasLayer(marker) === false &&
                        document.getElementById('toggle2025Sampled').checked) {
                        // Don't add/remove from layer - just track visibility
                    }
                    marker.setStyle({ opacity: 1, fillOpacity: 0.85 });
                    if (marker.getTooltip()) marker.getTooltip().setOpacity(1);
                } else {
                    marker.setStyle({ opacity: 0.15, fillOpacity: 0.1 });
                    if (marker.getTooltip()) marker.getTooltip().setOpacity(0.3);
                }
            }
            if (visible) matchCount++;
        });

        // Filter EA samples
        data.eaSamples.forEach(function(e) {
            var visible = matchesSample(e, 'ea');
            var listItem = document.querySelector('.sample-item[data-type="EA"][data-id="' + e.id + '"]');
            if (listItem) listItem.style.display = visible ? '' : 'none';

            var marker = AppState.markersEA[e.id];
            if (marker) {
                if (visible) {
                    marker.setOpacity(1);
                    if (marker.getTooltip()) marker.getTooltip().setOpacity(1);
                } else {
                    marker.setOpacity(0.15);
                    if (marker.getTooltip()) marker.getTooltip().setOpacity(0.3);
                }
            }
            if (visible) matchCount++;
        });

        // Update match count
        var countEl = document.getElementById('searchMatchCount');
        if (countEl) {
            var hasFilter = activeFilters.text || activeFilters.source !== 'all' ||
                activeFilters.exceedance !== 'all' || activeFilters.analyte !== 'any' ||
                activeFilters.minValue !== null || activeFilters.maxValue !== null;
            countEl.textContent = hasFilter ? matchCount + ' matches' : '';
            countEl.style.display = hasFilter ? 'inline' : 'none';
        }
    }

    /**
     * Check if a sample matches the current filters.
     */
    function matchesSample(sample, source) {
        // Text search
        if (activeFilters.text) {
            var id = (source === '2025') ? (sample.label || '').toLowerCase() : (sample.id || '').toLowerCase();
            if (id.indexOf(activeFilters.text) === -1) return false;
        }

        // Source filter
        if (activeFilters.source !== 'all') {
            if (activeFilters.source === '2025' && source !== '2025') return false;
            if (activeFilters.source === 'ea' && source !== 'ea') return false;
        }

        // Exceedance filter
        if (activeFilters.exceedance !== 'all') {
            var hasExceedance = false;
            if (source === '2025') {
                if (sample.metals) {
                    hasExceedance = AppConfig.exceedsROD(sample.metals.Mercury, 'Mercury') ||
                        AppConfig.exceedsROD(sample.metals.Arsenic, 'Arsenic') ||
                        AppConfig.exceedsROD(sample.metals.Antimony, 'Antimony') ||
                        AppConfig.exceedsROD(sample.metals.Thallium, 'Thallium');
                }
            } else {
                hasExceedance = AppConfig.exceedsROD(sample.mercury, 'Mercury') ||
                    AppConfig.exceedsROD(sample.arsenic, 'Arsenic') ||
                    AppConfig.exceedsROD(sample.antimony, 'Antimony') ||
                    AppConfig.exceedsROD(sample.thallium, 'Thallium');
            }
            if (activeFilters.exceedance === 'exceeds' && !hasExceedance) return false;
            if (activeFilters.exceedance === 'below' && hasExceedance) return false;
        }

        // Analyte-specific value filter
        if (activeFilters.analyte !== 'any' && (activeFilters.minValue !== null || activeFilters.maxValue !== null)) {
            var val = (source === '2025')
                ? Utils.getSampleValue(sample, activeFilters.analyte, false)
                : Utils.getSampleValue(sample, activeFilters.analyte, true);

            if (val === null || val === undefined) return false;
            if (activeFilters.minValue !== null && val < activeFilters.minValue) return false;
            if (activeFilters.maxValue !== null && val > activeFilters.maxValue) return false;
        }

        return true;
    }

    /**
     * Reset all filters to defaults.
     */
    function resetFilters() {
        activeFilters.text = '';
        activeFilters.source = 'all';
        activeFilters.exceedance = 'all';
        activeFilters.analyte = 'any';
        activeFilters.minValue = null;
        activeFilters.maxValue = null;

        var searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        var sourceFilter = document.getElementById('filterSource');
        if (sourceFilter) sourceFilter.value = 'all';
        var exceedFilter = document.getElementById('filterExceedance');
        if (exceedFilter) exceedFilter.value = 'all';
        var analyteFilter = document.getElementById('filterAnalyte');
        if (analyteFilter) analyteFilter.value = 'any';
        var minFilter = document.getElementById('filterMinValue');
        if (minFilter) minFilter.value = '';
        var maxFilter = document.getElementById('filterMaxValue');
        if (maxFilter) maxFilter.value = '';

        applyFilters();
    }

    /**
     * Zoom to a search result by ID.
     */
    function zoomToSample(id, source) {
        var marker;
        if (source === '2025') {
            marker = AppState.markers2025[parseInt(id)];
        } else {
            marker = AppState.markersEA[id];
        }
        if (marker) {
            AppState.map.setView(marker.getLatLng(), 19);
            marker.openPopup();
        }
    }

    return {
        init: init,
        applyFilters: applyFilters,
        resetFilters: resetFilters,
        zoomToSample: zoomToSample,
        getActiveFilters: function() { return activeFilters; }
    };
})();
