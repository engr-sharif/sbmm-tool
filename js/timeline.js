/**
 * SBMM Planning Tool - Timeline / Temporal View Module
 *
 * Toggle between different sampling periods to see how
 * site understanding has evolved over time.
 */
var TimelineModule = (function() {
    'use strict';

    var currentPeriod = 'all';
    var periods = {
        ea: {
            label: 'EA Historical (Pre-2025)',
            layers: ['eaSamples', 'eaTestPits'],
            checkboxes: ['toggleEASamples', 'toggleEATestPits'],
            description: 'EA Engineering RI/FS investigation data'
        },
        jacobs2025: {
            label: '2025 Jacobs PDI',
            layers: ['sampled2025', 'notSampled2025', 'testPits2025', 'soilBorings2025'],
            checkboxes: ['toggle2025Sampled', 'toggle2025NotSampled', 'toggleTestPits2025', 'toggleSoilBorings2025'],
            description: '2025 Pre-Design Investigation sampling'
        },
        all: {
            label: 'All Data Combined',
            layers: ['sampled2025', 'notSampled2025', 'eaSamples', 'eaTestPits', 'testPits2025', 'soilBorings2025'],
            checkboxes: ['toggle2025Sampled', 'toggle2025NotSampled', 'toggleEASamples', 'toggleEATestPits', 'toggleTestPits2025', 'toggleSoilBorings2025'],
            description: 'Combined view of all sampling periods'
        }
    };

    function init() {
        // Buttons handled in app.js
    }

    /**
     * Set the active time period.
     * @param {string} period - 'ea', 'jacobs2025', or 'all'
     */
    function setPeriod(period) {
        if (!periods[period]) return;
        currentPeriod = period;

        var config = periods[period];

        // Uncheck all layer checkboxes first
        var allCheckboxes = ['toggle2025Sampled', 'toggle2025NotSampled', 'toggleEASamples',
            'toggleEATestPits', 'toggleTestPits2025', 'toggleSoilBorings2025'];

        allCheckboxes.forEach(function(id) {
            var cb = document.getElementById(id);
            if (cb) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });

        // Check the layers for this period
        config.checkboxes.forEach(function(id) {
            var cb = document.getElementById(id);
            if (cb) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });

        // Update timeline button states
        document.querySelectorAll('.timeline-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-period') === period);
        });

        // Update description
        var descEl = document.getElementById('timelineDesc');
        if (descEl) descEl.textContent = config.description;

        // Update sample counts
        updatePeriodCounts();
    }

    /**
     * Update displayed sample counts for current period.
     */
    function updatePeriodCounts() {
        var countEl = document.getElementById('timelineSampleCount');
        if (!countEl) return;

        var count = 0;
        var data = AppState.data;

        if (currentPeriod === 'ea' || currentPeriod === 'all') {
            count += data.eaSamples.length;
            count += data.eaTestPits.length;
        }
        if (currentPeriod === 'jacobs2025' || currentPeriod === 'all') {
            count += data.samples2025.length;
            count += data.testPits2025.length;
            count += data.soilBorings2025.length;
        }

        countEl.textContent = count + ' locations';
    }

    /**
     * Get the current period.
     */
    function getCurrentPeriod() {
        return currentPeriod;
    }

    return {
        init: init,
        setPeriod: setPeriod,
        getCurrentPeriod: getCurrentPeriod,
        periods: periods
    };
})();
