/**
 * SBMM Planning Tool - Sample Comparison Module
 *
 * Side-by-side comparison of two samples showing all analyte data.
 */
var CompareModule = (function() {
    'use strict';

    var selectedSamples = [];
    var compareMode = false;

    function init() {
        // Compare button handled in app.js
    }

    /**
     * Toggle compare mode on/off.
     */
    function toggle() {
        compareMode = !compareMode;
        selectedSamples = [];
        var btn = document.getElementById('btn-compare');
        var mapEl = document.getElementById('map');
        var panel = document.getElementById('comparePanel');

        if (compareMode) {
            btn.classList.add('active');
            mapEl.classList.add('compare-mode');
            showInstruction('Click first sample to compare...');
        } else {
            btn.classList.remove('active');
            mapEl.classList.remove('compare-mode');
            if (panel) panel.classList.remove('visible');
        }
    }

    /**
     * Show instruction text in the compare panel.
     */
    function showInstruction(text) {
        var panel = document.getElementById('comparePanel');
        if (!panel) return;
        panel.innerHTML = '<div class="compare-instruction">' + text + '</div>';
        panel.classList.add('visible');
    }

    /**
     * Add a sample to the comparison. Called when clicking markers in compare mode.
     * @param {string} id - Sample ID or label
     * @param {string} source - '2025' or 'ea'
     */
    function addSample(id, source) {
        if (!compareMode) return;

        var sampleData = null;
        if (source === '2025') {
            var s = AppState.data.samples2025.find(function(s) { return s.label === id || s.num === parseInt(id); });
            if (s && s.sampled && s.metals) {
                sampleData = {
                    id: s.label,
                    source: '2025 Jacobs',
                    lat: s.lat,
                    lon: s.lon,
                    values: {}
                };
                AppConfig.allMetals.forEach(function(m) {
                    sampleData.values[m] = s.metals[m];
                });
            }
        } else {
            var e = AppState.data.eaSamples.find(function(e) { return e.id === id; });
            if (e) {
                sampleData = {
                    id: e.id,
                    source: 'EA Historical',
                    lat: e.lat,
                    lon: e.lon,
                    values: {
                        Mercury: e.mercury,
                        Arsenic: e.arsenic,
                        Antimony: e.antimony,
                        Thallium: e.thallium
                    }
                };
            }
        }

        if (!sampleData) return;

        // Prevent adding same sample twice
        if (selectedSamples.length > 0 && selectedSamples[0].id === sampleData.id) return;

        selectedSamples.push(sampleData);

        if (selectedSamples.length === 1) {
            showInstruction('Selected: ' + sampleData.id + ' \u2014 Click second sample...');
        } else if (selectedSamples.length === 2) {
            renderComparison();
        }
    }

    /**
     * Render the side-by-side comparison panel.
     */
    function renderComparison() {
        var panel = document.getElementById('comparePanel');
        if (!panel) return;

        var a = selectedSamples[0];
        var b = selectedSamples[1];

        // Calculate distance between samples
        var distMeters = L.latLng(a.lat, a.lon).distanceTo(L.latLng(b.lat, b.lon));
        var distFeet = distMeters * 3.28084;

        var html = '<div class="compare-header">' +
            '<h4>Sample Comparison</h4>' +
            '<span class="compare-distance">Distance: ' + distFeet.toFixed(1) + ' ft (' + distMeters.toFixed(1) + ' m)</span>' +
            '<button class="compare-close" onclick="CompareModule.close()">\u00d7</button>' +
            '</div>';

        // Build comparison table
        html += '<div class="compare-table-wrap"><table class="compare-table">' +
            '<thead><tr>' +
            '<th>Analyte</th>' +
            '<th class="compare-col-a">' + a.id + '<br><span class="compare-source">' + a.source + '</span></th>' +
            '<th class="compare-col-b">' + b.id + '<br><span class="compare-source">' + b.source + '</span></th>' +
            '<th>ROD</th>' +
            '<th>Difference</th>' +
            '</tr></thead><tbody>';

        // COCs first
        var cocs = ['Mercury', 'Arsenic', 'Antimony', 'Thallium'];
        cocs.forEach(function(analyte) {
            var valA = a.values[analyte];
            var valB = b.values[analyte];
            var thresh = AppConfig.thresholds[analyte];
            var exceedA = AppConfig.exceedsROD(valA, analyte);
            var exceedB = AppConfig.exceedsROD(valB, analyte);

            var diff = '';
            var diffClass = '';
            if (valA !== null && valA !== undefined && valB !== null && valB !== undefined) {
                var delta = valB - valA;
                diff = (delta >= 0 ? '+' : '') + Utils.formatVal(delta);
                diffClass = delta > 0 ? 'compare-higher' : (delta < 0 ? 'compare-lower' : '');
            }

            html += '<tr class="compare-coc">' +
                '<td><b>' + analyte + '</b> (' + thresh.abbrev + ')</td>' +
                '<td class="' + (exceedA ? 'compare-exceed' : '') + '">' + Utils.formatVal(valA) + '</td>' +
                '<td class="' + (exceedB ? 'compare-exceed' : '') + '">' + Utils.formatVal(valB) + '</td>' +
                '<td class="compare-rod">' + thresh.high + '</td>' +
                '<td class="' + diffClass + '">' + diff + '</td>' +
                '</tr>';
        });

        // Other metals (only if both are 2025 samples with full metals)
        var otherMetals = AppConfig.allMetals.filter(function(m) { return cocs.indexOf(m) === -1; });
        var hasOtherA = otherMetals.some(function(m) { return a.values[m] !== undefined; });
        var hasOtherB = otherMetals.some(function(m) { return b.values[m] !== undefined; });

        if (hasOtherA || hasOtherB) {
            html += '<tr class="compare-separator"><td colspan="5">Other Metals</td></tr>';
            otherMetals.forEach(function(m) {
                var valA = a.values[m];
                var valB = b.values[m];
                var diff = '';
                var diffClass = '';
                if (valA != null && valB != null) {
                    var delta = valB - valA;
                    diff = (delta >= 0 ? '+' : '') + Utils.formatVal(delta);
                    diffClass = delta > 0 ? 'compare-higher' : (delta < 0 ? 'compare-lower' : '');
                }
                html += '<tr>' +
                    '<td>' + m + '</td>' +
                    '<td>' + Utils.formatVal(valA) + '</td>' +
                    '<td>' + Utils.formatVal(valB) + '</td>' +
                    '<td></td>' +
                    '<td class="' + diffClass + '">' + diff + '</td>' +
                    '</tr>';
            });
        }

        html += '</tbody></table></div>';

        // Coordinates
        html += '<div class="compare-coords">' +
            a.id + ': ' + a.lat.toFixed(6) + ', ' + a.lon.toFixed(6) + ' | ' +
            b.id + ': ' + b.lat.toFixed(6) + ', ' + b.lon.toFixed(6) +
            '</div>';

        // New comparison button
        html += '<div class="compare-actions">' +
            '<button onclick="CompareModule.reset()">New Comparison</button>' +
            '</div>';

        panel.innerHTML = html;
        panel.classList.add('visible');
    }

    /**
     * Reset to pick new samples.
     */
    function reset() {
        selectedSamples = [];
        showInstruction('Click first sample to compare...');
    }

    /**
     * Close the comparison panel and exit compare mode.
     */
    function close() {
        compareMode = false;
        selectedSamples = [];
        var btn = document.getElementById('btn-compare');
        var mapEl = document.getElementById('map');
        var panel = document.getElementById('comparePanel');
        if (btn) btn.classList.remove('active');
        if (mapEl) mapEl.classList.remove('compare-mode');
        if (panel) panel.classList.remove('visible');
    }

    /**
     * Check if compare mode is active.
     */
    function isActive() {
        return compareMode;
    }

    return {
        init: init,
        toggle: toggle,
        addSample: addSample,
        reset: reset,
        close: close,
        isActive: isActive
    };
})();
