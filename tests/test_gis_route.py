import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services import walk_network as walk_network_module
from app.services.gis_route import build_walk_graph
from app.services.gis_route import extract_station_coordinates
from app.services.gis_route import find_nearest_station_by_walk


def _feature_collection(features):
    return {"type": "FeatureCollection", "features": features}


class GisWalkRoutingTests(unittest.TestCase):
    def test_extract_station_coordinates_ignores_deleted_station_features(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.5, 25.05]},
                    "properties": {"id": "station-a", "name": "Station A"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.6, 25.06]},
                    "properties": {"id": "station-b", "name": "Station B", "deleted": True},
                },
            ]
        )

        lookup = extract_station_coordinates(stations_geojson)

        self.assertEqual(lookup, {"station-a": (121.5, 25.05)})

    def test_walk_graph_nearest_node_returns_exact_match_without_distance_scan(self):
        walk_network = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [121.5, 25.05],
                            [121.5005, 25.0505],
                        ],
                    },
                    "properties": {},
                }
            ]
        )

        graph = build_walk_graph(walk_network)
        with patch("app.services.walk_network.haversine_distance_m", side_effect=AssertionError("unexpected scan")):
            result = graph.nearest_node(121.5, 25.05)

        self.assertEqual(result, (121.5, 25.05))

    def test_walk_graph_nearest_node_uses_local_spatial_bucket_for_non_exact_queries(self):
        walk_network = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[float(index) / 1000.0, 0.0] for index in range(257)],
                    },
                    "properties": {},
                }
            ]
        )

        graph = build_walk_graph(walk_network)
        original_distance = walk_network_module.haversine_distance_m
        call_count = 0

        def counting_distance(*args):
            nonlocal call_count
            call_count += 1
            return original_distance(*args)

        with patch("app.services.walk_network.haversine_distance_m", side_effect=counting_distance):
            result = graph.nearest_node(0.1282, 0.0)

        self.assertEqual(result, (0.128, 0.0))
        self.assertGreater(len(graph.spatial_index), 1)
        self.assertLess(call_count, len(graph.nodes))

    def test_walk_graph_nearest_node_finds_nearest_node_outside_graph_bounds(self):
        walk_network = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [0.0, 0.0],
                            [1.0, 0.0],
                            [2.0, 0.0],
                        ],
                    },
                    "properties": {},
                }
            ]
        )

        graph = build_walk_graph(walk_network)

        self.assertEqual(graph.nearest_node(-5.0, 0.0), (0.0, 0.0))
        self.assertEqual(graph.nearest_node(10.0, 0.0), (2.0, 0.0))

    def test_walk_routing_prefers_station_with_shorter_road_path(self):
        walk_network = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [1.0, 1.0],
                            [1.0, 0.0],
                            [0.0, 0.0],
                        ],
                    },
                    "properties": {},
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [1.0, 1.0],
                            [2.0, 1.0],
                        ],
                    },
                    "properties": {},
                },
            ]
        )
        station_coords_by_id = {
            "station-a": (1.05, 1.0),
            "station-b": (2.0, 1.0),
        }
        access_points = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {"station_id": "station-a", "name": "A Exit"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [2.0, 1.0]},
                    "properties": {"station_id": "station-b", "name": "B Exit"},
                },
            ]
        )

        graph = build_walk_graph(walk_network)
        result = find_nearest_station_by_walk(
            lon=1.0,
            lat=1.0,
            station_coords_by_id=station_coords_by_id,
            station_access_points_geojson=access_points,
            walk_network_geojson=walk_network,
            walk_graph=graph,
        )

        self.assertEqual(result.station_id, "station-b")
        self.assertEqual(result.path_coordinates, [(1.0, 1.0), (2.0, 1.0)])
        self.assertEqual(result.access_point_name, "B Exit")
        self.assertGreater(result.distance_m, 0)

    def test_walk_routing_falls_back_to_station_coordinate_when_no_access_point_exists(self):
        walk_network = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [121.5, 25.05],
                            [121.5005, 25.0505],
                        ],
                    },
                    "properties": {},
                }
            ]
        )
        station_coords_by_id = {
            "station-a": (121.5005, 25.0505),
        }

        result = find_nearest_station_by_walk(
            lon=121.5,
            lat=25.05,
            station_coords_by_id=station_coords_by_id,
            station_access_points_geojson=None,
            walk_network_geojson=walk_network,
        )

        self.assertEqual(result.station_id, "station-a")
        self.assertEqual(result.path_coordinates[0], (121.5, 25.05))
        self.assertEqual(result.path_coordinates[-1], (121.5005, 25.0505))


if __name__ == "__main__":
    unittest.main()
