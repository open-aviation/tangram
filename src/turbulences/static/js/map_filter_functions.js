function filterturb(data, time) {
    turbulences.clearLayers();
    if ($.isEmptyObject(data)) {
        return
    }
    L.geoJson(data, {
        onEachFeature: onEachTurb,
        filter: function (feature) {
            return (feature.properties.time <= time);
        },
    }).addTo(turbulences);
}
function filterairep(data, time) {
    aireps.clearLayers();
    if ($.isEmptyObject(data)) {
        return
    }
    filtered = L.geoJson(data, {
        onEachFeature: onEachAirep,
        filter: function (feature) {
            return (Date.parse(feature.properties.expire) / 1000 >= time) && (Date.parse(feature.properties.reported_time) / 1000 <= time);
        }
    });
    updateTableAirep(filtered.toGeoJSON());
    filtered.addTo(aireps);
}
function filtersigmet(data, time) {
    sigmets.clearLayers();
    if ($.isEmptyObject(data)) {
        return
    }
    filtered = L.geoJson(data, {
        style: function (feature) {
            var d = feature.properties.hazard;
            return d == "TS"
                ? { color: "red" }
                : d == "TURB"
                    ? { color: "blue" }
                    : d == "MTW"
                        ? { color: "yellow" }
                        : d == "ICE"
                            ? { color: "gray" }
                            : { color: "black" };
        },
        onEachFeature: onEachSigmet,
        filter: function (feature) {
            return (Date.parse(feature.properties.validTimeTo) / 1000 >= time) && (Date.parse(feature.properties.validTimeFrom) / 1000 <= time);
        }
    });
    updateTableSigmet(filtered.toGeoJSON());
    filtered.addTo(sigmets);
}
function filtercat(data, time) {
    cat_sev.clearLayers();
    cat_mod.clearLayers();
    if ($.isEmptyObject(data)) {
        return
    }
    L.geoJson(data, {
        filter: function (feature) {
            return (feature.properties.intensityValue == 2) && (Date.parse(feature.properties.endValidity) / 1000 >= time) && (Date.parse(feature.properties.startValidity) / 1000 <= time);
        },
        style: function () {
            return { color: "red", opacity: 0 }
        },
        onEachFeature: onEachCat,
    }).addTo(cat_sev);
    L.geoJson(data, {
        filter: function (feature) {
            return (feature.properties.intensityValue == 1) && (Date.parse(feature.properties.endValidity) / 1000 >= time) && (Date.parse(feature.properties.startValidity) / 1000 <= time);
        },
        style: function () {
            return { color: "gray", opacity: 0 }
        },
        onEachFeature: onEachCat,
    }).addTo(cat_mod);
}