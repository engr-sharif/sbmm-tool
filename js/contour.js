/**
 * SBMM Planning Tool - IDW Contour Interpolation
 *
 * Generates a color-coded canvas overlay showing interpolated contamination
 * levels across the site using Inverse Distance Weighting (IDW).
 *
 * Algorithm: For each grid cell, value = sum(v_i / d_i^2) / sum(1 / d_i^2)
 * where v_i is each sample value and d_i is the distance in meters.
 *
 * Rendering is clipped to the convex hull of sample points (with buffer)
 * and color-mapped through a green -> yellow -> orange -> red gradient
 * based on the current analyte's threshold levels.
 */
var ContourModule = (function() {
    'use strict';

    var conv = AppConfig.coordConversion;

    // ----- Configuration -----
    var GRID_METERS = 10;           // ~10 meter grid cells
    var IDW_POWER = 2;              // Power parameter (used conceptually; see optimization note)
    var HULL_BUFFER_METERS = 30;    // Buffer around convex hull for interpolation extent
    var OVERLAY_OPACITY = 0.5;      // Canvas overlay opacity so satellite shows through
    var BOUNDS_BUFFER_DEG = 0.0005; // Degree buffer on min/max lat/lon grid bounds

    // ----- Color Gradient Stops -----
    var C_GREEN  = { r: 114, g: 175, b: 38 };   // #72af26 - below thresh.low
    var C_YELLOW = { r: 240, g: 208, b: 0 };     // #f0d000 - at thresh.low
    var C_ORANGE = { r: 240, g: 147, b: 43 };    // #f0932b - at thresh.high
    var C_RED    = { r: 214, g: 62,  b: 42 };    // #d63e2a - above thresh.high

    // ================================================================
    //  Public API
    // ================================================================

    /**
     * Initialize contour state properties on AppState.
     */
    function init() {
        AppState.contourLayer = null;
        AppState.contourVisible = false;
    }

    /**
     * Toggle the contour overlay on or off.
     */
    function toggle() {
        AppState.contourVisible = !AppState.contourVisible;
        var btn = document.getElementById('btn-contour');

        if (AppState.contourVisible) {
            if (btn) btn.classList.add('active-contour');
            generateContour();
        } else {
            if (btn) btn.classList.remove('active-contour');
            removeContour();
        }
    }

    /**
     * Refresh the contour overlay (e.g., when the selected analyte changes).
     * Only regenerates if the contour is currently visible.
     */
    function refresh() {
        if (AppState.contourVisible) {
            generateContour();
        }
    }

    // ================================================================
    //  Contour Generation
    // ================================================================

    /**
     * Remove the current contour layer from the map.
     */
    function removeContour() {
        if (AppState.contourLayer) {
            AppState.map.removeLayer(AppState.contourLayer);
            AppState.contourLayer = null;
        }
    }

    /**
     * Generate the IDW contour overlay and add it to the map.
     *
     * Steps:
     *   1. Collect sample points with values for the current analyte
     *   2. Compute grid bounds from sample extents (with degree buffer)
     *   3. Build convex hull of sample points and expand by meter buffer
     *   4. For each grid cell, run IDW if inside the buffered hull
     *   5. Map interpolated value to RGBA via threshold-based color gradient
     *   6. Render canvas and attach as L.imageOverlay
     */
    function generateContour() {
        removeContour();

        var points = collectSamplePoints();
        if (points.length < 3) return;

        var analyte = AppState.currentAnalyte;
        var thresh = AppConfig.thresholds[analyte];
        if (!thresh) return;

        // --- Grid bounds from sample extents ---
        var lats = [];
        var lons = [];
        for (var i = 0; i < points.length; i++) {
            lats.push(points[i].lat);
            lons.push(points[i].lon);
        }
        var minLat = Math.min.apply(null, lats) - BOUNDS_BUFFER_DEG;
        var maxLat = Math.max.apply(null, lats) + BOUNDS_BUFFER_DEG;
        var minLon = Math.min.apply(null, lons) - BOUNDS_BUFFER_DEG;
        var maxLon = Math.max.apply(null, lons) + BOUNDS_BUFFER_DEG;

        // --- Grid cell sizes in degrees ---
        var cellLat = GRID_METERS / conv.metersPerDegLat;
        var cellLon = GRID_METERS / conv.metersPerDegLon;

        // --- Grid dimensions (pixels) ---
        var cols = Math.ceil((maxLon - minLon) / cellLon);
        var rows = Math.ceil((maxLat - minLat) / cellLat);

        // Safety clamp for very large grids
        if (cols > 1000) cols = 1000;
        if (rows > 1000) rows = 1000;

        // --- Convex hull with buffer for spatial clipping ---
        var hull = computeConvexHull(points);
        var bufferedHull = bufferConvexHull(hull, HULL_BUFFER_METERS);

        // --- Create canvas and compute IDW for each cell ---
        var canvas = document.createElement('canvas');
        canvas.width = cols;
        canvas.height = rows;
        var ctx = canvas.getContext('2d');
        var imageData = ctx.createImageData(cols, rows);
        var pixels = imageData.data;

        for (var row = 0; row < rows; row++) {
            // Canvas row 0 is the top (maxLat), row N is the bottom (minLat)
            var lat = maxLat - (row + 0.5) * cellLat;

            for (var col = 0; col < cols; col++) {
                var lon = minLon + (col + 0.5) * cellLon;

                // Only interpolate within the buffered convex hull
                if (!pointInConvexHull(lat, lon, bufferedHull)) continue;

                // IDW interpolation
                var value = computeIDW(lat, lon, points);

                // Threshold-based color mapping
                var color = valueToColor(value, thresh);

                // Write RGBA pixel (fully opaque; overlay opacity handles transparency)
                var idx = (row * cols + col) * 4;
                pixels[idx]     = color.r;
                pixels[idx + 1] = color.g;
                pixels[idx + 2] = color.b;
                pixels[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // --- Attach canvas as a Leaflet image overlay ---
        var bounds = L.latLngBounds(
            L.latLng(minLat, minLon),
            L.latLng(maxLat, maxLon)
        );

        AppState.contourLayer = L.imageOverlay(
            canvas.toDataURL(),
            bounds,
            { opacity: OVERLAY_OPACITY, interactive: false }
        ).addTo(AppState.map);
    }

    // ================================================================
    //  Data Collection
    // ================================================================

    /**
     * Collect all sample points that have a numeric value for the current analyte.
     * Merges 2025 surface samples (sampled only) and EA historical samples.
     *
     * @returns {Array<{lat: number, lon: number, value: number}>}
     */
    function collectSamplePoints() {
        var analyte = AppState.currentAnalyte;
        var points = [];

        // 2025 surface samples (sampled only, value from sample.metals[analyte])
        var samples2025 = AppState.data.samples2025;
        for (var i = 0; i < samples2025.length; i++) {
            var s = samples2025[i];
            if (!s.sampled) continue;
            var val = s.metals ? s.metals[analyte] : null;
            if (val !== null && val !== undefined && !isNaN(val)) {
                points.push({ lat: s.lat, lon: s.lon, value: val });
            }
        }

        // EA historical samples (value from Utils.getSampleValue)
        var eaSamples = AppState.data.eaSamples;
        for (var j = 0; j < eaSamples.length; j++) {
            var e = eaSamples[j];
            var eVal = Utils.getSampleValue(e, analyte, true);
            if (eVal !== null && eVal !== undefined && !isNaN(eVal)) {
                points.push({ lat: e.lat, lon: e.lon, value: eVal });
            }
        }

        return points;
    }

    // ================================================================
    //  IDW Interpolation
    // ================================================================

    /**
     * Compute the IDW interpolated value at a given coordinate.
     *
     * Uses power parameter p = 2. Since weight = 1/dist^2 = 1/distSq,
     * we avoid the sqrt entirely by working with squared distances.
     *
     * If the query point is within 1 meter of a sample, the sample's
     * exact value is returned (avoids division by near-zero).
     *
     * @param {number} lat - Query latitude
     * @param {number} lon - Query longitude
     * @param {Array} points - Sample points with lat, lon, value
     * @returns {number} Interpolated value
     */
    function computeIDW(lat, lon, points) {
        var numerator = 0;
        var denominator = 0;

        for (var i = 0; i < points.length; i++) {
            var dLat = (lat - points[i].lat) * conv.metersPerDegLat;
            var dLon = (lon - points[i].lon) * conv.metersPerDegLon;
            var distSq = dLat * dLat + dLon * dLon;

            // Coincident with sample point (within 1m) -- return exact value
            if (distSq < 1.0) {
                return points[i].value;
            }

            // weight = 1 / dist^p, with p=2: weight = 1 / distSq
            var weight = 1.0 / distSq;
            numerator += points[i].value * weight;
            denominator += weight;
        }

        return denominator > 0 ? numerator / denominator : 0;
    }

    // ================================================================
    //  Convex Hull -- Andrew's Monotone Chain Algorithm
    // ================================================================

    /**
     * Compute the convex hull of a set of points.
     * Returns vertices in counter-clockwise order.
     *
     * @param {Array<{lat: number, lon: number}>} points
     * @returns {Array<{lat: number, lon: number}>} Hull vertices (CCW)
     */
    function computeConvexHull(points) {
        if (points.length < 3) return points.slice();

        // Sort by longitude (x), then by latitude (y)
        var sorted = points.slice().sort(function(a, b) {
            return a.lon !== b.lon ? a.lon - b.lon : a.lat - b.lat;
        });

        // Build lower hull (left to right, keeping only left turns)
        var lower = [];
        for (var i = 0; i < sorted.length; i++) {
            while (lower.length >= 2 &&
                cross2D(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
                lower.pop();
            }
            lower.push(sorted[i]);
        }

        // Build upper hull (right to left, keeping only left turns)
        var upper = [];
        for (var j = sorted.length - 1; j >= 0; j--) {
            while (upper.length >= 2 &&
                cross2D(upper[upper.length - 2], upper[upper.length - 1], sorted[j]) <= 0) {
                upper.pop();
            }
            upper.push(sorted[j]);
        }

        // Remove last vertex of each half (duplicated as first of the other)
        lower.pop();
        upper.pop();

        return lower.concat(upper);
    }

    /**
     * 2D cross product of vectors OA and OB (treating lon as x, lat as y).
     * Positive result means counter-clockwise (left) turn.
     */
    function cross2D(O, A, B) {
        return (A.lon - O.lon) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lon - O.lon);
    }

    /**
     * Expand a convex hull outward by a buffer distance (in meters).
     *
     * Each vertex is pushed radially outward from the hull centroid
     * by the buffer amount, using proper meters-to-degrees conversion.
     *
     * @param {Array} hull - Convex hull vertices
     * @param {number} bufferMeters - Buffer distance in meters
     * @returns {Array} Expanded hull vertices
     */
    function bufferConvexHull(hull, bufferMeters) {
        if (hull.length < 3) return hull;

        // Compute centroid of hull
        var centLat = 0;
        var centLon = 0;
        for (var i = 0; i < hull.length; i++) {
            centLat += hull[i].lat;
            centLon += hull[i].lon;
        }
        centLat /= hull.length;
        centLon /= hull.length;

        // Buffer distance in degrees (per axis)
        var bufLat = bufferMeters / conv.metersPerDegLat;
        var bufLon = bufferMeters / conv.metersPerDegLon;

        var buffered = [];
        for (var j = 0; j < hull.length; j++) {
            var dLat = hull[j].lat - centLat;
            var dLon = hull[j].lon - centLon;

            // Normalize direction in meter-space for uniform buffer
            var dLatM = dLat * conv.metersPerDegLat;
            var dLonM = dLon * conv.metersPerDegLon;
            var dist = Math.sqrt(dLatM * dLatM + dLonM * dLonM);

            if (dist < 0.001) {
                buffered.push({ lat: hull[j].lat, lon: hull[j].lon });
                continue;
            }

            // Push vertex outward along the centroid->vertex direction
            buffered.push({
                lat: hull[j].lat + (dLatM / dist) * bufLat,
                lon: hull[j].lon + (dLonM / dist) * bufLon
            });
        }

        return buffered;
    }

    /**
     * Test whether a point lies inside a convex polygon.
     *
     * For a CCW-wound polygon, an interior point is to the left of every
     * directed edge.  The cross product of (edge direction) x (edge-to-point)
     * is positive for left-side points.  Any negative cross product means
     * the point is outside.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Array} hull - CCW-ordered convex hull vertices
     * @returns {boolean}
     */
    function pointInConvexHull(lat, lon, hull) {
        var n = hull.length;
        if (n < 3) return false;

        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            var cross = (hull[j].lon - hull[i].lon) * (lat - hull[i].lat) -
                        (hull[j].lat - hull[i].lat) * (lon - hull[i].lon);
            if (cross < 0) return false;
        }
        return true;
    }

    // ================================================================
    //  Color Mapping
    // ================================================================

    /**
     * Linearly interpolate between two RGB colors.
     *
     * @param {Object} c1 - Start color {r, g, b}
     * @param {Object} c2 - End color {r, g, b}
     * @param {number} t  - Interpolation factor [0, 1]
     * @returns {Object} Interpolated color {r, g, b}
     */
    function lerpColor(c1, c2, t) {
        t = Math.max(0, Math.min(1, t));
        return {
            r: Math.round(c1.r + (c2.r - c1.r) * t),
            g: Math.round(c1.g + (c2.g - c1.g) * t),
            b: Math.round(c1.b + (c2.b - c1.b) * t)
        };
    }

    /**
     * Map a contamination value to an RGB color using the analyte thresholds.
     *
     * Gradient stops:
     *   value <= 0          : green  (#72af26)
     *   value  = thresh.low : yellow (#f0d000)
     *   value  = thresh.high: orange (#f0932b)
     *   value >= overshoot  : red    (#d63e2a)
     *
     * When thresh.low === thresh.high (single-threshold analytes like As, Tl),
     * the yellow-to-orange band collapses and the gradient runs
     * green -> yellow -> red.
     *
     * @param {number} value - Interpolated contamination value
     * @param {Object} thresh - { low, high } threshold object
     * @returns {Object} Color {r, g, b}
     */
    function valueToColor(value, thresh) {
        if (value <= 0) return C_GREEN;

        // Single-threshold analytes (low === high, e.g. Arsenic, Thallium)
        if (thresh.low === thresh.high) {
            if (value < thresh.low) {
                return lerpColor(C_GREEN, C_YELLOW, value / thresh.low);
            }
            // Above threshold: yellow -> red over a range equal to the threshold
            var t = Math.min((value - thresh.high) / thresh.high, 1);
            return lerpColor(C_YELLOW, C_RED, t);
        }

        // Dual-threshold analytes (e.g. Mercury, Antimony)
        if (value < thresh.low) {
            // Below PMB: green -> yellow
            return lerpColor(C_GREEN, C_YELLOW, value / thresh.low);
        }

        if (value < thresh.high) {
            // Between PMB and ROD: yellow -> orange
            return lerpColor(C_YELLOW, C_ORANGE,
                (value - thresh.low) / (thresh.high - thresh.low));
        }

        // Above ROD: orange -> red over a range equal to (high - low)
        var range = thresh.high - thresh.low;
        var t2 = Math.min((value - thresh.high) / range, 1);
        return lerpColor(C_ORANGE, C_RED, t2);
    }

    // ================================================================
    //  Module Exports
    // ================================================================

    return {
        init: init,
        toggle: toggle,
        refresh: refresh
    };
})();
