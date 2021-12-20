from flask import Blueprint, current_app, send_from_directory

from .converter import geojson_plane

base_bp = Blueprint("base", __name__)


@base_bp.route("/turb.geojson")
def turbulence():
    features = []
    pro_data = current_app.client.pro_data
    if pro_data is not None:
        turb = pro_data.query("turbulence")
        if turb is not None:
            for flight in turb:
                if flight.shape is not None:
                    for segment in flight.split("1T"):
                        x = segment.geojson()
                        x.update({"properties": {"icao": flight.icao24}})
                        features.append(x)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    return geojson


@base_bp.route("/planes.geojson")
def fetch_planes_Geojson() -> dict:
    data = current_app.client.traffic
    return geojson_plane(data)


@base_bp.route("/sigmet.geojson", defaults={"wef": None, "und": None})
@base_bp.route("/sigmet.geojson/<path:wef>,<path:und>")
def fetch_sigmets(wef, und) -> dict:
    res = current_app.sigmet.sigmets(wef, und, fir="^(L|E)")
    res = res._to_geo()
    return res


@base_bp.route("/plane.png")
def favicon():
    return send_from_directory("./static", "plane.png")


@base_bp.route("/airep.geojson", defaults={"wef": None, "und": None})
@base_bp.route("/airep.geojson/<path:wef>,<path:und>")
def airep_geojson(wef, und):
    data = current_app.airep.aireps(wef, und)
    if data is not None:
        result = data._to_geo()
    else:
        result = {}
    return result


@base_bp.route("/cat.geojson", defaults={"wef": None, "und": None})
@base_bp.route("/cat.geojson/<path:wef>,<path:und>")
def clear_air_turbulence(wef, und):
    res = current_app.cat.metsafe(
        "metgate:cat_mf_arpege01_europe",
        wef=wef,
        und=und,
        bounds="France métropolitaine",
    )
    return res._to_geo()
