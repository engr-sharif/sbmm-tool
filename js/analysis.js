/**
 * SBMM Planning Tool - Analysis Tools
 *
 * Data gap analysis, hot zone analysis, distance measurement,
 * and buffer zone visualization.
 */
var AnalysisModule = (function() {
    'use strict';

    var conv = AppConfig.coordConversion;

    // ===== MEASUREMENT TOOL =====

    function toggleMeasureMode() {
        AppState.measureMode = !AppState.measureMode;
        var btn = document.getElementById('btn-measure');
        var mapEl = document.getElementById('map');

        if (AppState.measureMode) {
            btn.classList.add('active');
            mapEl.classList.add('measure-mode');
            clearMeasurement();
            document.getElementById('measureResult').classList.add('visible');
            document.getElementById('distanceValue').textContent = 'Click 2 points...';
            document.getElementById('distanceMeters').textContent = '\u2014';
        } else {
            btn.classList.remove('active');
            mapEl.classList.remove('measure-mode');
            clearMeasurement();
            document.getElementById('measureResult').classList.remove('visible');
        }
    }

    function handleMeasureClick(latlng) {
        var marker = L.circleMarker(latlng, {
            radius: 6, fillColor: '#ffff00', color: '#000',
            weight: 2, fillOpacity: 1
        }).addTo(AppState.map);
        AppState.measureMarkers.push(marker);
        AppState.measurePoints.push(latlng);

        if (AppState.measurePoints.length === 1) {
            document.getElementById('distanceValue').textContent = 'Click 2nd point...';
        } else if (AppState.measurePoints.length === 2) {
            AppState.measureLine = L.polyline(AppState.measurePoints, {
                color: '#ffff00', weight: 3, dashArray: '10, 5'
            }).addTo(AppState.map);

            var dist = AppState.measurePoints[0].distanceTo(AppState.measurePoints[1]);
            var distFeet = dist * 3.28084;
            document.getElementById('distanceValue').textContent = distFeet.toFixed(1);
            document.getElementById('distanceMeters').textContent = dist.toFixed(1);

            setTimeout(function() {
                clearMeasurement();
                document.getElementById('distanceValue').textContent = 'Click 2 points...';
                document.getElementById('distanceMeters').textContent = '\u2014';
            }, 3000);
        }
    }

    function clearMeasurement() {
        AppState.measureMarkers.forEach(function(m) { AppState.map.removeLayer(m); });
        AppState.measureMarkers = [];
        AppState.measurePoints = [];
        if (AppState.measureLine) {
            AppState.map.removeLayer(AppState.measureLine);
            AppState.measureLine = null;
        }
    }

    // ===== GRID SIZE ADJUSTMENT =====

    function adjustGridSize(delta) {
        var defaults = AppConfig.gridDefaults;
        var newSize = AppState.gridSizeFt + delta;
        if (newSize < defaults.minSizeFt) newSize = defaults.minSizeFt;
        if (newSize > defaults.maxSizeFt) newSize = defaults.maxSizeFt;
        AppState.gridSizeFt = newSize;

        document.getElementById('gridSizeDisplay').textContent = AppState.gridSizeFt + ' ft';
        document.getElementById('gapGridSize').textContent = AppState.gridSizeFt;

        if (AppState.gapsVisible) createGapGrid();
        if (AppState.hotzoneVisible) createHotZoneGrid();
    }

    function toggleIncludePlanned() {
        AppState.includePlannedInGaps = !AppState.includePlannedInGaps;
        var btn = document.getElementById('btn-include-planned');
        if (AppState.includePlannedInGaps) {
            btn.textContent = 'On';
            btn.classList.add('active');
        } else {
            btn.textContent = 'Off';
            btn.classList.remove('active');
        }
        if (AppState.gapsVisible) createGapGrid();
    }

    // ===== GAP ANALYSIS =====

    function toggleGapAnalysis() {
        AppState.gapsVisible = !AppState.gapsVisible;
        var btn = document.getElementById('btn-gaps');
        var legend = document.getElementById('gapLegend');

        if (AppState.gapsVisible) {
            btn.classList.add('active-gap');
            legend.classList.add('visible');
            document.getElementById('gapGridSize').textContent = AppState.gridSizeFt;
            createGapGrid();
        } else {
            btn.classList.remove('active-gap');
            legend.classList.remove('visible');
            if (AppState.gapLayer) {
                AppState.map.removeLayer(AppState.gapLayer);
                AppState.gapLayer = null;
            }
        }
    }

    function createGapGrid() {
        if (AppState.gapLayer) AppState.map.removeLayer(AppState.gapLayer);
        AppState.gapLayer = L.layerGroup().addTo(AppState.map);

        var data = AppState.data;

        var baseSamples = [];
        data.samples2025.filter(function(s) { return s.sampled; }).forEach(function(s) {
            baseSamples.push({ lat: s.lat, lon: s.lon });
        });
        data.eaSamples.forEach(function(e) {
            baseSamples.push({ lat: e.lat, lon: e.lon });
        });

        var densitySamples = baseSamples.slice();
        if (AppState.includePlannedInGaps) {
            AppState.plannedPoints.forEach(function(p) {
                densitySamples.push({ lat: p.lat, lon: p.lon });
            });
        }

        var lats = baseSamples.map(function(s) { return s.lat; });
        var lons = baseSamples.map(function(s) { return s.lon; });
        var minLat = Math.min.apply(null, lats) - 0.0005;
        var maxLat = Math.max.apply(null, lats) + 0.0005;
        var minLon = Math.min.apply(null, lons) - 0.0005;
        var maxLon = Math.max.apply(null, lons) + 0.0005;

        var sizeMeters = AppState.gridSizeFt * conv.feetToMeters;
        var gridSizeLat = sizeMeters / conv.metersPerDegLat;
        var gridSizeLon = sizeMeters / conv.metersPerDegLon;
        var searchRadius = sizeMeters;

        for (var lat = minLat; lat < maxLat; lat += gridSizeLat) {
            for (var lon = minLon; lon < maxLon; lon += gridSizeLon) {
                var centerLat = lat + gridSizeLat / 2;
                var centerLon = lon + gridSizeLon / 2;
                var centerLatLng = L.latLng(centerLat, centerLon);

                var count = 0;
                for (var si = 0; si < densitySamples.length; si++) {
                    var s = densitySamples[si];
                    if (centerLatLng.distanceTo(L.latLng(s.lat, s.lon)) <= searchRadius) {
                        count++;
                    }
                }

                var color, opacity;
                if (count === 0) {
                    color = '#ff0000'; opacity = 0.35;
                } else if (count <= 2) {
                    color = '#ffff00'; opacity = 0.3;
                } else {
                    color = '#00ff00'; opacity = 0.2;
                }

                L.rectangle(
                    [[lat, lon], [lat + gridSizeLat, lon + gridSizeLon]],
                    { color: color, weight: 0.5, fillColor: color, fillOpacity: opacity, opacity: 0.5 }
                ).addTo(AppState.gapLayer);
            }
        }
    }

    // ===== HOT ZONE ANALYSIS =====

    function toggleHotZones() {
        AppState.hotzoneVisible = !AppState.hotzoneVisible;
        var btn = document.getElementById('btn-hotzone');
        var legend = document.getElementById('hotzoneLegend');

        if (AppState.hotzoneVisible) {
            btn.classList.add('active-hotzone');
            legend.classList.add('visible');
            updateHotZoneLegend();
            createHotZoneGrid();
        } else {
            btn.classList.remove('active-hotzone');
            legend.classList.remove('visible');
            if (AppState.hotzoneLayer) {
                AppState.map.removeLayer(AppState.hotzoneLayer);
                AppState.hotzoneLayer = null;
            }
        }
    }

    function updateHotZoneLegend() {
        var abbrevs = AppConfig.getAnalyteAbbreviations();
        var thresh = AppConfig.thresholds[AppState.currentAnalyte];
        document.getElementById('hotzoneAnalyte').textContent = abbrevs[AppState.currentAnalyte];

        var legendItems = document.getElementById('hotzoneLegend').querySelectorAll('.gap-legend-item');
        if (thresh.high === thresh.low) {
            legendItems[0].innerHTML = '<span class="gap-box" style="background:rgba(255,0,0,0.5)"></span>Exceeds ROD (>' + thresh.high + ')';
            legendItems[1].innerHTML = '<span class="gap-box" style="background:rgba(255,165,0,0.4)"></span>N/A';
            legendItems[2].innerHTML = '<span class="gap-box" style="background:rgba(0,200,0,0.25)"></span>Below ROD (\u2264' + thresh.low + ')';
        } else {
            legendItems[0].innerHTML = '<span class="gap-box" style="background:rgba(255,0,0,0.5)"></span>Exceeds ROD (>' + thresh.high + ')';
            legendItems[1].innerHTML = '<span class="gap-box" style="background:rgba(255,165,0,0.4)"></span>Above PMB (' + thresh.low + '-' + thresh.high + ')';
            legendItems[2].innerHTML = '<span class="gap-box" style="background:rgba(0,200,0,0.25)"></span>Below PMB (\u2264' + thresh.low + ')';
        }
    }

    function createHotZoneGrid() {
        if (AppState.hotzoneLayer) AppState.map.removeLayer(AppState.hotzoneLayer);
        AppState.hotzoneLayer = L.layerGroup().addTo(AppState.map);

        var data = AppState.data;
        var analyte = AppState.currentAnalyte;

        var allSamples = [];
        data.samples2025.filter(function(s) { return s.sampled; }).forEach(function(s) {
            var val = Utils.getSampleValue(s, analyte, false);
            if (val !== null && val !== undefined) {
                allSamples.push({ lat: s.lat, lon: s.lon, value: val });
            }
        });
        data.eaSamples.forEach(function(e) {
            var val = Utils.getSampleValue(e, analyte, true);
            if (val !== null && val !== undefined) {
                allSamples.push({ lat: e.lat, lon: e.lon, value: val });
            }
        });

        if (allSamples.length === 0) return;

        var lats = allSamples.map(function(s) { return s.lat; });
        var lons = allSamples.map(function(s) { return s.lon; });
        var minLat = Math.min.apply(null, lats) - 0.0005;
        var maxLat = Math.max.apply(null, lats) + 0.0005;
        var minLon = Math.min.apply(null, lons) - 0.0005;
        var maxLon = Math.max.apply(null, lons) + 0.0005;

        var sizeMeters = AppState.gridSizeFt * conv.feetToMeters;
        var gridSizeLat = sizeMeters / conv.metersPerDegLat;
        var gridSizeLon = sizeMeters / conv.metersPerDegLon;
        var searchRadius = sizeMeters;
        var thresh = AppConfig.thresholds[analyte];

        for (var lat = minLat; lat < maxLat; lat += gridSizeLat) {
            for (var lon = minLon; lon < maxLon; lon += gridSizeLon) {
                var centerLat = lat + gridSizeLat / 2;
                var centerLon = lon + gridSizeLon / 2;
                var centerLatLng = L.latLng(centerLat, centerLon);

                var maxVal = 0;
                var foundAny = false;
                for (var si = 0; si < allSamples.length; si++) {
                    var s = allSamples[si];
                    if (centerLatLng.distanceTo(L.latLng(s.lat, s.lon)) <= searchRadius) {
                        foundAny = true;
                        if (s.value > maxVal) maxVal = s.value;
                    }
                }

                if (!foundAny) continue;

                var color, opacity;
                if (maxVal > thresh.high) {
                    color = '#ff0000'; opacity = 0.5;
                } else if (maxVal > thresh.low) {
                    color = '#ff9900'; opacity = 0.4;
                } else {
                    color = '#00cc00'; opacity = 0.25;
                }

                L.rectangle(
                    [[lat, lon], [lat + gridSizeLat, lon + gridSizeLon]],
                    { color: color, weight: 0.5, fillColor: color, fillOpacity: opacity, opacity: 0.5 }
                ).addTo(AppState.hotzoneLayer);
            }
        }
    }

    // ===== BUFFER ZONE VISUALIZATION =====

    function toggleBufferZones() {
        AppState.bufferVisible = !AppState.bufferVisible;
        var btn = document.getElementById('btn-buffer');
        var legend = document.getElementById('bufferLegend');

        if (AppState.bufferVisible) {
            if (btn) btn.classList.add('active-buffer');
            if (legend) legend.classList.add('visible');
            createBufferZones();
        } else {
            if (btn) btn.classList.remove('active-buffer');
            if (legend) legend.classList.remove('visible');
            removeBufferZones();
        }
    }

    function adjustBufferRadius(delta) {
        AppState.bufferRadiusFt = Math.max(25, Math.min(200, AppState.bufferRadiusFt + delta));
        var display = document.getElementById('bufferRadiusDisplay');
        if (display) display.textContent = AppState.bufferRadiusFt + ' ft';
        if (AppState.bufferVisible) createBufferZones();
    }

    function createBufferZones() {
        removeBufferZones();
        AppState.bufferLayer = L.layerGroup().addTo(AppState.map);

        var data = AppState.data;
        var analyte = AppState.currentAnalyte;
        var radiusMeters = AppState.bufferRadiusFt * conv.feetToMeters;

        data.samples2025.forEach(function(s) {
            if (!s.sampled) return;
            var val = Utils.getSampleValue(s, analyte, false);
            if (val === null || val === undefined) return;
            if (!AppConfig.exceedsROD(val, analyte)) return;

            L.circle([s.lat, s.lon], {
                radius: radiusMeters,
                color: '#d63e2a',
                weight: 2,
                dashArray: '6, 4',
                fillColor: '#d63e2a',
                fillOpacity: 0.12,
                interactive: false
            }).addTo(AppState.bufferLayer);
        });

        data.eaSamples.forEach(function(e) {
            var val = Utils.getSampleValue(e, analyte, true);
            if (val === null || val === undefined) return;
            if (!AppConfig.exceedsROD(val, analyte)) return;

            L.circle([e.lat, e.lon], {
                radius: radiusMeters,
                color: '#d63e2a',
                weight: 2,
                dashArray: '6, 4',
                fillColor: '#d63e2a',
                fillOpacity: 0.12,
                interactive: false
            }).addTo(AppState.bufferLayer);
        });
    }

    function removeBufferZones() {
        if (AppState.bufferLayer) {
            AppState.map.removeLayer(AppState.bufferLayer);
            AppState.bufferLayer = null;
        }
    }

    function refreshBufferZones() {
        if (AppState.bufferVisible) {
            createBufferZones();
        }
    }

    // Public API
    return {
        toggleMeasureMode: toggleMeasureMode,
        handleMeasureClick: handleMeasureClick,
        adjustGridSize: adjustGridSize,
        toggleIncludePlanned: toggleIncludePlanned,
        toggleGapAnalysis: toggleGapAnalysis,
        createGapGrid: createGapGrid,
        toggleHotZones: toggleHotZones,
        updateHotZoneLegend: updateHotZoneLegend,
        createHotZoneGrid: createHotZoneGrid,
        toggleBufferZones: toggleBufferZones,
        adjustBufferRadius: adjustBufferRadius,
        refreshBufferZones: refreshBufferZones
    };
})();
