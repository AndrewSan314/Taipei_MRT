import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.api.routes import BuilderLinePayload
from app.api.routes import BuilderNetworkSaveRequest
from app.api.routes import BuilderStationLinePayload
from app.api.routes import BuilderStationPayload
from app.api.routes import CalibrationSaveRequest
from app.api.routes import GisPointRouteRequest
from app.api.routes import PointRouteRequest
from app.api.routes import RouteRequest
from app.api.routes import get_builder_network
from app.api.routes import get_gis_route_for_points
from app.api.routes import get_gis_network
from app.api.routes import get_network
from app.api.routes import get_route_for_points
from app.api.routes import get_route
from app.api.routes import save_builder_network
from app.api.routes import save_calibration
from app.main import health_check


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_endpoint(self):
        body = await health_check()

        self.assertEqual(body, {"status": "ok"})

    async def test_network_endpoint_returns_stations_and_segments(self):
        body = await get_network()

        self.assertIn("map", body)
        self.assertIn("diagram", body)
        self.assertIn("stations", body)
        self.assertIn("segments", body)
        self.assertGreaterEqual(len(body["stations"]), 150)
        self.assertEqual(body["map"]["image_url"], "/map/geography/taipei-vector-map-2022.svg")
        self.assertTrue(body["map"]["is_vector"])
        self.assertFalse(body["map"]["supports_line_hints"])
        self.assertEqual(body["diagram"]["svg_url"], "/map/diagram/taipei_mrt_interactive.svg")
        self.assertTrue(body["diagram"]["is_vector"])

    async def test_gis_network_endpoint_returns_geojson_payload(self):
        body = await get_gis_network()

        self.assertIn("source", body)
        self.assertIn("bounds", body)
        self.assertIn("stations", body)
        self.assertIn("lines", body)
        self.assertEqual(body["stations"]["type"], "FeatureCollection")
        self.assertEqual(body["lines"]["type"], "FeatureCollection")
        self.assertGreaterEqual(len(body["stations"]["features"]), 150)

    async def test_gis_route_points_endpoint_returns_station_route(self):
        body = await get_gis_route_for_points(
            GisPointRouteRequest(
                start_lon=121.5010,
                start_lat=25.0420,
                end_lon=121.5515,
                end_lat=25.0238,
                walking_m_per_sec=1.3,
            )
        )

        self.assertIn("selected_start_station", body)
        self.assertIn("selected_end_station", body)
        self.assertIn("route", body)
        self.assertGreaterEqual(body["total_journey_time_sec"], body["route"]["total_time_sec"])
        self.assertGreater(len(body["route"]["station_ids"]), 1)

    async def test_builder_network_endpoint_returns_raw_station_lines(self):
        body = await get_builder_network()

        self.assertIn("station_lines", body)
        self.assertIn("stations", body)
        self.assertIn("lines", body)
        self.assertIn("diagram", body)

    async def test_route_endpoint_returns_route_payload(self):
        network = await get_network()
        station_lookup = {
            station["name"]: station["id"]
            for station in network["stations"]
        }

        body = await get_route(
            RouteRequest(
                start_station_id=station_lookup["Ximen"],
                end_station_id=station_lookup["Liuzhangli"],
            )
        )

        self.assertGreaterEqual(body["transfer_count"], 0)
        self.assertEqual(body["station_ids"][0], station_lookup["Ximen"])
        self.assertEqual(body["station_ids"][-1], station_lookup["Liuzhangli"])
        self.assertGreater(len(body["steps"]), 0)
        self.assertTrue(any(step["kind"] == "ride" for step in body["steps"]))

    async def test_point_route_endpoint_returns_best_station_pair(self):
        network = await get_network()
        stations_by_name = {
            station["name"]: station
            for station in network["stations"]
        }
        start_station = stations_by_name["Ximen"]
        end_station = stations_by_name["Liuzhangli"]

        body = await get_route_for_points(
            PointRouteRequest(
                start_x=start_station["x"],
                start_y=start_station["y"],
                end_x=end_station["x"],
                end_y=end_station["y"],
                walking_seconds_per_pixel=1.0,
                start_preferred_line_ids=start_station["line_ids"],
                end_preferred_line_ids=end_station["line_ids"],
            )
        )

        self.assertEqual(body["selected_start_station"]["id"], start_station["id"])
        self.assertEqual(body["selected_end_station"]["id"], end_station["id"])
        self.assertEqual(body["route"]["station_ids"][0], start_station["id"])
        self.assertEqual(body["route"]["station_ids"][-1], end_station["id"])

    async def test_point_route_endpoint_passes_via_stations_to_engine(self):
        network_payload = await get_network()
        station_ids = [station["id"] for station in network_payload["stations"][:3]]
        start_station_id, via_station_id, end_station_id = station_ids
        captured: dict = {}

        class DummyEngine:
            def find_best_route_for_points(self, **kwargs):
                captured.update(kwargs)
                return {
                    "start_point": {"x": 0, "y": 0},
                    "end_point": {"x": 1, "y": 1},
                    "selected_start_station": {"id": start_station_id, "name": "", "x": 0, "y": 0, "line_ids": []},
                    "selected_end_station": {"id": end_station_id, "name": "", "x": 0, "y": 0, "line_ids": []},
                    "via_stations": [{"id": via_station_id, "name": "", "x": 0, "y": 0, "line_ids": []}],
                    "access_walk_distance_px": 0,
                    "egress_walk_distance_px": 0,
                    "access_walk_time_sec": 0,
                    "egress_walk_time_sec": 0,
                    "total_journey_time_sec": 0,
                    "route": {
                        "total_time_sec": 0,
                        "walking_time_sec": 0,
                        "transfer_count": 0,
                        "stop_count": 0,
                        "station_ids": [start_station_id, via_station_id, end_station_id],
                        "line_sequence": [],
                        "steps": [],
                    },
                }

        with patch("app.api.routes.get_route_engine", return_value=DummyEngine()):
            body = await get_route_for_points(
                PointRouteRequest(
                    start_x=0,
                    start_y=0,
                    end_x=1,
                    end_y=1,
                    via_station_ids=[via_station_id],
                )
            )

        self.assertEqual(captured["via_station_ids"], [via_station_id])
        self.assertEqual(body["route"]["station_ids"], [start_station_id, via_station_id, end_station_id])

    async def test_save_calibration_calls_store_and_refreshes_cache(self):
        request = CalibrationSaveRequest(
            stations=[
                {"id": "X1", "x": 1200, "y": 2800},
                {"id": "X2", "x": 1400, "y": 3400},
            ]
        )

        with (
            patch("app.api.routes.save_station_positions", return_value=2) as save_mock,
            patch("app.api.routes.refresh_runtime_caches") as refresh_mock,
        ):
            body = await save_calibration(request)

        self.assertEqual(body["updated_count"], 2)
        save_mock.assert_called_once()
        refresh_mock.assert_called_once()

    async def test_save_builder_network_persists_full_network_and_refreshes_cache(self):
        request = BuilderNetworkSaveRequest(
            stations=[
                BuilderStationPayload(id="S1", name="Alpha", x=100, y=200),
                BuilderStationPayload(id="S2", name="Beta", x=220, y=260),
            ],
            lines=[
                BuilderLinePayload(id="red", name="Red Line", color="#d94f4f"),
            ],
            station_lines=[
                BuilderStationLinePayload(station_id="S1", line_id="red", seq=1),
                BuilderStationLinePayload(station_id="S2", line_id="red", seq=2),
            ],
            default_travel_sec=90,
            default_transfer_sec=180,
        )

        with (
            patch("app.api.routes.save_network_definition", return_value={"stations": 2, "lines": 1}) as save_mock,
            patch("app.api.routes.refresh_runtime_caches") as refresh_mock,
        ):
            body = await save_builder_network(request)

        self.assertEqual(body["saved"]["stations"], 2)
        self.assertEqual(body["saved"]["lines"], 1)
        save_mock.assert_called_once()
        refresh_mock.assert_called_once()

    async def test_save_builder_network_rejects_unknown_station_line_reference(self):
        request = BuilderNetworkSaveRequest(
            stations=[
                BuilderStationPayload(id="S1", name="Alpha", x=100, y=200),
            ],
            lines=[
                BuilderLinePayload(id="red", name="Red Line", color="#d94f4f"),
            ],
            station_lines=[
                BuilderStationLinePayload(station_id="S2", line_id="red", seq=1),
            ],
        )

        with self.assertRaises(HTTPException) as context:
            await save_builder_network(request)

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Unknown station_id", context.exception.detail)


if __name__ == "__main__":
    unittest.main()
