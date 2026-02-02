/**
 * SBMM Planning Tool - Print / Report Export Module
 *
 * Generates a clean print view of the current map state with legend,
 * title block, and optional export as PNG.
 */
var PrintModule = (function() {
    'use strict';

    /**
     * Initialize print module.
     */
    function init() {
        // Button handled in app.js
    }

    /**
     * Generate and open a print-ready view.
     */
    function printView() {
        // Capture current map state
        var map = AppState.map;
        var center = map.getCenter();
        var zoom = map.getZoom();
        var bounds = map.getBounds();
        var analyte = AppState.currentAnalyte;
        var thresh = AppConfig.thresholds[analyte];

        // Build active layers list
        var activeLayers = [];
        if (document.getElementById('toggle2025Sampled').checked) activeLayers.push('2025 Sampled');
        if (document.getElementById('toggle2025NotSampled').checked) activeLayers.push('2025 Not Sampled');
        if (document.getElementById('toggleEASamples').checked) activeLayers.push('EA Samples');
        if (document.getElementById('toggleEATestPits').checked) activeLayers.push('EA Test Pits');
        if (document.getElementById('toggleTestPits2025').checked) activeLayers.push('2025 Test Pits');
        if (document.getElementById('toggleSoilBorings2025').checked) activeLayers.push('2025 Soil Borings');
        if (document.getElementById('togglePlanned').checked) activeLayers.push('Planned Points (' + AppState.plannedPoints.length + ')');

        // Build stats
        var stats = calculateStats();

        // Generate the print HTML
        var printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Pop-up blocked. Please allow pop-ups for this site.');
            return;
        }

        var html = '<!DOCTYPE html><html><head><title>SBMM ABP Sampling Map - ' + new Date().toLocaleDateString() + '</title>' +
            '<style>' +
            '* { margin: 0; padding: 0; box-sizing: border-box; }' +
            'body { font-family: Arial, sans-serif; padding: 20px; }' +
            '.title-block { border: 2px solid #1F4E79; padding: 15px; margin-bottom: 15px; }' +
            '.title-block h1 { color: #1F4E79; font-size: 18px; margin-bottom: 5px; }' +
            '.title-block .subtitle { color: #666; font-size: 12px; }' +
            '.title-block .meta { display: flex; justify-content: space-between; margin-top: 10px; font-size: 10px; color: #444; }' +
            '.map-container { border: 1px solid #333; margin-bottom: 15px; text-align: center; background: #eee; padding: 10px; }' +
            '.map-container img { max-width: 100%; }' +
            '.map-note { font-size: 11px; color: #888; margin-top: 5px; font-style: italic; }' +
            '.info-grid { display: flex; gap: 15px; margin-bottom: 15px; }' +
            '.info-box { flex: 1; border: 1px solid #ccc; padding: 10px; border-radius: 4px; }' +
            '.info-box h3 { font-size: 11px; color: #1F4E79; margin-bottom: 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }' +
            '.legend-item { display: flex; align-items: center; margin: 3px 0; font-size: 10px; }' +
            '.legend-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; border: 1px solid #333; }' +
            '.legend-triangle { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 9px solid; margin-right: 6px; }' +
            '.stats-table { width: 100%; border-collapse: collapse; font-size: 10px; }' +
            '.stats-table th { text-align: left; padding: 3px 6px; background: #f0f0f0; }' +
            '.stats-table td { padding: 3px 6px; border-bottom: 1px solid #eee; }' +
            '.stats-table .exceed { color: #d63e2a; font-weight: bold; }' +
            '.layers-list { font-size: 10px; }' +
            '.layers-list div { margin: 2px 0; }' +
            '.footer { margin-top: 20px; padding-top: 10px; border-top: 2px solid #1F4E79; display: flex; justify-content: space-between; font-size: 9px; color: #666; }' +
            '.planned-table { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 8px; }' +
            '.planned-table th { text-align: left; padding: 2px 6px; background: #333; color: #fff; }' +
            '.planned-table td { padding: 2px 6px; border-bottom: 1px solid #eee; }' +
            '@media print { body { padding: 10px; } .no-print { display: none; } }' +
            '</style></head><body>';

        // Title block
        html += '<div class="title-block">' +
            '<h1>SBMM ABP Soil Sampling - Combined Analysis Map</h1>' +
            '<div class="subtitle">Sulphur Bank Mercury Mine Superfund Site | OU1 Area Between Piles | Lake County, California</div>' +
            '<div class="meta">' +
            '<span>Color by: ' + analyte + ' (' + thresh.abbrev + ') | Thresholds: PMB=' + thresh.low + ', ROD=' + thresh.high + ' mg/kg</span>' +
            '<span>Generated: ' + new Date().toLocaleString() + '</span>' +
            '</div></div>';

        // Map placeholder
        html += '<div class="map-container">' +
            '<div class="map-note">Map Center: ' + center.lat.toFixed(6) + ', ' + center.lng.toFixed(6) + ' | Zoom: ' + zoom + '<br>' +
            'Bounds: SW(' + bounds.getSouthWest().lat.toFixed(5) + ', ' + bounds.getSouthWest().lng.toFixed(5) + ') to NE(' + bounds.getNorthEast().lat.toFixed(5) + ', ' + bounds.getNorthEast().lng.toFixed(5) + ')<br><br>' +
            'To include the map image: take a screenshot of the current map view and paste it here,<br>or use your browser\'s built-in screenshot tool (Ctrl+Shift+S in Chrome/Edge).</div>' +
            '</div>';

        // Info grid
        html += '<div class="info-grid">';

        // Legend box
        html += '<div class="info-box"><h3>Legend (' + analyte + ': ' + thresh.low + '/' + thresh.high + ' mg/kg)</h3>' +
            '<div class="legend-item"><span class="legend-dot" style="background:#d63e2a;"></span>HIGH &gt;' + thresh.high + ' (Exceeds ROD)</div>' +
            '<div class="legend-item"><span class="legend-dot" style="background:#f0932b;"></span>MED ' + thresh.low + '-' + thresh.high + ' (Above PMB)</div>' +
            '<div class="legend-item"><span class="legend-dot" style="background:#72af26;"></span>LOW &le;' + thresh.low + ' (Below PMB)</div>' +
            '<div class="legend-item"><span class="legend-dot" style="background:#808080;"></span>Not Sampled</div>' +
            '<div style="margin-top:6px;border-top:1px solid #ddd;padding-top:4px;">' +
            '<div class="legend-item"><span class="legend-dot" style="background:#0099cc;border-color:#006699;"></span>Soil Boring</div>' +
            '<div class="legend-item"><span style="color:#cc6600;font-weight:bold;margin-right:6px;">\u2715</span>Test Pit</div>' +
            '</div></div>';

        // Stats box
        html += '<div class="info-box"><h3>Sample Statistics (' + analyte + ')</h3>' +
            '<table class="stats-table">' +
            '<tr><th>Dataset</th><th>Count</th><th>Min</th><th>Max</th><th>Mean</th><th>Exceedances</th></tr>';

        stats.forEach(function(s) {
            html += '<tr>' +
                '<td>' + s.name + '</td>' +
                '<td>' + s.count + '</td>' +
                '<td>' + (s.min !== null ? Utils.formatVal(s.min) : '\u2014') + '</td>' +
                '<td class="' + (s.maxExceeds ? 'exceed' : '') + '">' + (s.max !== null ? Utils.formatVal(s.max) : '\u2014') + '</td>' +
                '<td>' + (s.mean !== null ? Utils.formatVal(s.mean) : '\u2014') + '</td>' +
                '<td class="' + (s.exceedCount > 0 ? 'exceed' : '') + '">' + s.exceedCount + '</td>' +
                '</tr>';
        });

        html += '</table></div>';

        // Active layers box
        html += '<div class="info-box"><h3>Active Layers</h3><div class="layers-list">';
        activeLayers.forEach(function(l) {
            html += '<div>\u2713 ' + l + '</div>';
        });
        if (activeLayers.length === 0) html += '<div style="color:#888;">No layers active</div>';
        html += '</div></div>';

        html += '</div>';

        // Planned points table (if any)
        if (AppState.plannedPoints.length > 0) {
            html += '<div class="info-box" style="margin-bottom:15px;"><h3>Planned Sample Locations (' + AppState.plannedPoints.length + ')</h3>' +
                '<table class="planned-table">' +
                '<tr><th>Point ID</th><th>Type</th><th>Depth</th><th>Latitude</th><th>Longitude</th><th>Note</th></tr>';
            AppState.plannedPoints.forEach(function(p) {
                html += '<tr><td>' + p.id + '</td><td>' + p.type + '</td><td>' + (p.depth || 'Shallow') + '</td>' +
                    '<td>' + p.lat.toFixed(6) + '</td><td>' + p.lon.toFixed(6) + '</td><td>' + (p.note || '') + '</td></tr>';
            });
            html += '</table></div>';
        }

        // Footer
        html += '<div class="footer">' +
            '<span>SBMM ABP Soil Sampling Planning Tool v2.0 | Jacobs Engineering</span>' +
            '<span>Prepared by: Mo Sharif, EIT | ' + new Date().toLocaleDateString() + '</span>' +
            '<span>INTERNAL USE ONLY - Subject to QA Review</span>' +
            '</div>';

        // Print button (no-print)
        html += '<div class="no-print" style="text-align:center;margin-top:20px;">' +
            '<button onclick="window.print()" style="padding:10px 30px;font-size:14px;cursor:pointer;background:#1F4E79;color:white;border:none;border-radius:4px;">Print / Save as PDF</button>' +
            '</div>';

        html += '</body></html>';

        printWindow.document.write(html);
        printWindow.document.close();
    }

    /**
     * Calculate summary statistics for the report.
     */
    function calculateStats() {
        var analyte = AppState.currentAnalyte;
        var results = [];

        // 2025 samples
        var vals2025 = [];
        AppState.data.samples2025.forEach(function(s) {
            if (s.sampled && s.metals) {
                var v = s.metals[analyte];
                if (v !== null && v !== undefined) vals2025.push(v);
            }
        });
        results.push(buildStats('2025 Jacobs', vals2025, analyte));

        // EA samples
        var valsEA = [];
        AppState.data.eaSamples.forEach(function(e) {
            var v = Utils.getSampleValue(e, analyte, true);
            if (v !== null && v !== undefined) valsEA.push(v);
        });
        results.push(buildStats('EA Historical', valsEA, analyte));

        // Combined
        var combined = vals2025.concat(valsEA);
        results.push(buildStats('Combined', combined, analyte));

        return results;
    }

    function buildStats(name, values, analyte) {
        if (values.length === 0) {
            return { name: name, count: 0, min: null, max: null, mean: null, exceedCount: 0, maxExceeds: false };
        }
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var sum = values.reduce(function(a, b) { return a + b; }, 0);
        var mean = sum / values.length;
        var exceedCount = values.filter(function(v) { return AppConfig.exceedsROD(v, analyte); }).length;
        return {
            name: name,
            count: values.length,
            min: min,
            max: max,
            mean: mean,
            exceedCount: exceedCount,
            maxExceeds: AppConfig.exceedsROD(max, analyte)
        };
    }

    return {
        init: init,
        printView: printView
    };
})();
