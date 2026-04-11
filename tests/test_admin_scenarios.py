import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.api.routes import GisPointRouteRequest
from app.api.routes import get_gis_route_for_points
from app.domain.models import Line
from app.domain.models import Station
from app.domain.models import SubwayNetwork
from app.services.admin_scenarios import apply_admin_scenarios_to_network
from app.services.admin_scenarios import build_admin_scenario_effects
from app.services.gis_route import build_walk_graph
from app.services.route_engine import RouteEngine


def _feature_collection(features):
    return {"type": "FeatureCollection", "features": features}


def _point_feature(station_id, lon, lat, line_ids):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "id": station_id,
            "name": station_id.upper(),
            "line_ids": line_ids,
        },
    }


def _line_feature(line_id, coordinates):
    return {
        "type": "Feature",
        "geometry": {"type": "MultiLineString", "coordinates": [coordinates]},
        "properties": {
            "line_id": line_id,
            "line_name": line_id.upper(),
            "line_color": "#123456",
        },
    }


def _sample_network():
    return SubwayNetwork(
        stations={
            "A": Station(id="A", name="A", x=0, y=0),
            "B": Station(id="B", name="B", x=0, y=0),
            "C": Station(id="C", name="C", x=0, y=0),
            "D": Station(id="D", name="D", x=0, y=0),
        },
        lines={
            "blue": Line(id="blue", name="Blue", color="#0000ff"),
            "red": Line(id="red", name="Red", color="#ff0000"),
        },
        station_lines=[],
        segments=[],
        transfers=[],
        station_to_lines={
            "A": {"blue", "red"},
            "B": {"blue"},
            "C": {"blue", "red"},
            "D": {"red"},
        },
    )


def _sample_network_with_topology():
    network = _sample_network()
    network.station_lines = [
        type("StationLineLike", (), {"station_id": "A", "line_id": "blue", "seq": 1})(),
        type("StationLineLike", (), {"station_id": "B", "line_id": "blue", "seq": 2})(),
        type("StationLineLike", (), {"station_id": "C", "line_id": "blue", "seq": 3})(),
        type("StationLineLike", (), {"station_id": "A", "line_id": "red", "seq": 1})(),
        type("StationLineLike", (), {"station_id": "D", "line_id": "red", "seq": 2})(),
        type("StationLineLike", (), {"station_id": "C", "line_id": "red", "seq": 3})(),
    ]
    network.segments = [
        type("SegmentLike", (), {"line_id": "blue", "from_station_id": "A", "to_station_id": "B", "travel_sec": 60})(),
        type("SegmentLike", (), {"line_id": "blue", "from_station_id": "B", "to_station_id": "C", "travel_sec": 60})(),
        type("SegmentLike", (), {"line_id": "red", "from_station_id": "A", "to_station_id": "D", "travel_sec": 80})(),
        type("SegmentLike", (), {"line_id": "red", "from_station_id": "D", "to_station_id": "C", "travel_sec": 80})(),
    ]
    return network


def _sample_gis_payload():
    return {
        "source": "qgis_geojson",
        "bounds": [0.0, 0.0, 2.0, 2.0],
        "stations": _feature_collection(
            [
                _point_feature("A", 0.0, 0.0, ["blue", "red"]),
                _point_feature("B", 1.0, 0.0, ["blue"]),
                _point_feature("C", 2.0, 0.0, ["blue", "red"]),
                _point_feature("D", 1.0, 1.0, ["red"]),
            ]
        ),
        "lines": _feature_collection(
            [
                _line_feature("blue", [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]),
                _line_feature("red", [[0.0, 0.0], [1.0, 1.0], [2.0, 0.0]]),
            ]
        ),
        "station_access_points": None,
        "walk_network": None,
    }


class AdminScenarioTests(unittest.TestCase):
    def test_build_admin_scenario_effects_collects_rain_snap_exclusions_and_blocked_segments(self):
        network = _sample_network_with_topology()
        gis_payload = _sample_gis_payload()
        scenarios = {
            "rain_zones": [{"id": "rain-1", "center": {"lon": 2.0, "lat": 0.0}, "radius_m": 100}],
            "block_segments": [{"id": "block-1", "kind": "point", "from": {"lon": 1.0, "lat": 1.0}, "to": {"lon": 1.0, "lat": 1.0}}],
            "banned_stations": [{"id": "B"}],
        }

        effects = build_admin_scenario_effects(network, gis_payload, scenarios)

        self.assertEqual(sorted(effects["closed_station_ids"]), ["B"])
        self.assertEqual(sorted(effects["rain_station_ids"]), ["C"])
        self.assertIn("red:A:D", effects["closed_segment_keys"])
        self.assertIn("red:C:D", effects["closed_segment_keys"])

    def test_apply_admin_scenarios_to_network_forces_route_onto_alternate_line(self):
        network = _sample_network_with_topology()
        filtered = apply_admin_scenarios_to_network(
            network,
            {
                "closed_station_ids": ["B"],
                "closed_segment_keys": [],
            },
        )

        result = RouteEngine(filtered).find_route("A", "C")

        self.assertEqual(result.station_ids, ["A", "D", "C"])
        self.assertEqual(result.line_sequence, ["red"])


class AdminScenarioApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_gis_route_uses_active_admin_scenarios(self):
        network = _sample_network_with_topology()
        gis_payload = _sample_gis_payload()
        scenarios = {
            "rain_zones": [],
            "block_segments": [],
            "banned_stations": [{"id": "B"}],
        }

        with (
            patch("app.api.routes.get_subway_network", return_value=network),
            patch("app.api.routes.build_gis_payload", return_value=gis_payload),
            patch("app.api.routes.get_cached_walk_graph", return_value=build_walk_graph(None)),
            patch("app.api.routes.load_admin_scenarios", return_value=scenarios),
        ):
            body = await get_gis_route_for_points(
                GisPointRouteRequest(
                    start_lon=1.0,
                    start_lat=0.0,
                    end_lon=2.0,
                    end_lat=0.0,
                    walking_m_per_sec=1.3,
                )
            )

        self.assertEqual(body["route"]["station_ids"], ["A", "D", "C"])
        self.assertEqual(body["route"]["line_sequence"], ["red"])
        self.assertEqual(body["selected_start_station"]["id"], "A")
        self.assertEqual(
            [item["station_id"] for item in body["start_station_attempts"][:2]],
            ["B", "A"],
        )
        self.assertEqual(body["start_station_attempts"][0]["status"], "rejected")
        self.assertEqual(body["start_station_attempts"][1]["status"], "selected")
        self.assertEqual(body["admin_effects"]["explicit_banned_station_ids"], ["B"])

    async def test_gis_route_rain_only_blocks_start_and_end_station_selection(self):
        network = _sample_network_with_topology()
        gis_payload = _sample_gis_payload()
        scenarios = {
            "rain_zones": [{"id": "rain-1", "center": {"lon": 1.0, "lat": 0.0}, "radius_m": 60000}],
            "block_segments": [],
            "banned_stations": [],
        }

        with (
            patch("app.api.routes.get_subway_network", return_value=network),
            patch("app.api.routes.build_gis_payload", return_value=gis_payload),
            patch("app.api.routes.get_cached_walk_graph", return_value=build_walk_graph(None)),
            patch("app.api.routes.load_admin_scenarios", return_value=scenarios),
        ):
            body = await get_gis_route_for_points(
                GisPointRouteRequest(
                    start_lon=0.0,
                    start_lat=0.0,
                    end_lon=2.0,
                    end_lat=0.0,
                    walking_m_per_sec=1.3,
                )
            )

        self.assertEqual(body["selected_start_station"]["id"], "A")
        self.assertEqual(body["selected_end_station"]["id"], "C")
        self.assertEqual(body["route"]["station_ids"], ["A", "B", "C"])
        self.assertEqual(body["route"]["line_sequence"], ["blue"])
        self.assertEqual(body["admin_effects"]["rain_station_ids"], ["B"])


if __name__ == "__main__":
    unittest.main()
