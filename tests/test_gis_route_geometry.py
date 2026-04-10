import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.gis_route_geometry import _build_geojson_segment_index
from app.services.gis_route_geometry import build_ride_path_features


def _feature_collection(features):
    return {"type": "FeatureCollection", "features": features}


class GisRideGeometryTests(unittest.TestCase):
    def test_build_ride_path_features_follows_gis_line_shape(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [1.0, 1.0]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "MultiLineString",
                        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
                    },
                    "properties": {"line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        features = build_ride_path_features(
            route_steps=[
                {
                    "kind": "ride",
                    "station_id": "station-a",
                    "line_id": "c2",
                    "next_station_id": "station-b",
                    "duration_sec": 60,
                }
            ],
            station_coords_by_id={
                "station-a": (0.0, 0.0),
                "station-b": (1.0, 1.0),
            },
            stations_geojson=stations_geojson,
            lines_geojson=lines_geojson,
        )

        self.assertEqual(len(features), 1)
        self.assertEqual(
            features[0]["geometry"]["coordinates"],
            [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
        )

    def test_build_ride_path_features_merges_consecutive_steps_on_same_line(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [1.0, 1.0]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [2.0, 1.0]},
                    "properties": {"id": "station-c", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "MultiLineString",
                        "coordinates": [[[0.0, 0.0], [1.0, 1.0], [2.0, 1.0]]],
                    },
                    "properties": {"line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        features = build_ride_path_features(
            route_steps=[
                {
                    "kind": "ride",
                    "station_id": "station-a",
                    "line_id": "c2",
                    "next_station_id": "station-b",
                    "duration_sec": 60,
                },
                {
                    "kind": "ride",
                    "station_id": "station-b",
                    "line_id": "c2",
                    "next_station_id": "station-c",
                    "duration_sec": 60,
                },
            ],
            station_coords_by_id={
                "station-a": (0.0, 0.0),
                "station-b": (1.0, 1.0),
                "station-c": (2.0, 1.0),
            },
            stations_geojson=stations_geojson,
            lines_geojson=lines_geojson,
        )

        self.assertEqual(len(features), 1)
        self.assertEqual(
            features[0]["geometry"]["coordinates"],
            [[0.0, 0.0], [1.0, 1.0], [2.0, 1.0]],
        )

    def test_build_ride_path_features_falls_back_when_single_run_stops_short(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0, 25.0]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.001, 25.0]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.002, 25.0]},
                    "properties": {"id": "station-c", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.004, 25.0]},
                    "properties": {"id": "station-d", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.0, 25.0], [121.001, 25.0], [121.002, 25.0]],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.002, 25.0], [121.003, 25.0], [121.004, 25.0]],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                },
            ]
        )

        features = build_ride_path_features(
            route_steps=[
                {
                    "kind": "ride",
                    "station_id": "station-a",
                    "line_id": "c2",
                    "next_station_id": "station-b",
                    "duration_sec": 60,
                },
                {
                    "kind": "ride",
                    "station_id": "station-b",
                    "line_id": "c2",
                    "next_station_id": "station-c",
                    "duration_sec": 60,
                },
                {
                    "kind": "ride",
                    "station_id": "station-c",
                    "line_id": "c2",
                    "next_station_id": "station-d",
                    "duration_sec": 60,
                },
            ],
            station_coords_by_id={
                "station-a": (121.0, 25.0),
                "station-b": (121.001, 25.0),
                "station-c": (121.002, 25.0),
                "station-d": (121.004, 25.0),
            },
            stations_geojson=stations_geojson,
            lines_geojson=lines_geojson,
        )

        self.assertEqual(len(features), 1)
        self.assertEqual(
            features[0]["geometry"]["coordinates"],
            [
                [121.0, 25.0],
                [121.001, 25.0],
                [121.002, 25.0],
                [121.003, 25.0],
                [121.004, 25.0],
            ],
        )

    def test_build_ride_path_features_anchors_path_to_station_coordinates(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0, 25.00002]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.001, 25.00002]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.0, 25.0], [121.0005, 25.0], [121.001, 25.0]],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        features = build_ride_path_features(
            route_steps=[
                {
                    "kind": "ride",
                    "station_id": "station-a",
                    "line_id": "c2",
                    "next_station_id": "station-b",
                    "duration_sec": 60,
                }
            ],
            station_coords_by_id={
                "station-a": (121.0, 25.00002),
                "station-b": (121.001, 25.00002),
            },
            stations_geojson=stations_geojson,
            lines_geojson=lines_geojson,
        )

        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["geometry"]["coordinates"][0], [121.0, 25.00002])
        self.assertEqual(features[0]["geometry"]["coordinates"][-1], [121.001, 25.00002])

    def test_build_ride_path_features_stitches_connected_multiline_parts(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0, 25.0]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.003, 25.001]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "MultiLineString",
                        "coordinates": [
                            [[121.0, 25.0], [121.001, 25.0]],
                            [[121.001, 25.0], [121.002, 25.0004]],
                            [[121.002, 25.0004], [121.003, 25.001]],
                        ],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        features = build_ride_path_features(
            route_steps=[
                {
                    "kind": "ride",
                    "station_id": "station-a",
                    "line_id": "c2",
                    "next_station_id": "station-b",
                    "duration_sec": 60,
                }
            ],
            station_coords_by_id={
                "station-a": (121.0, 25.0),
                "station-b": (121.003, 25.001),
            },
            stations_geojson=stations_geojson,
            lines_geojson=lines_geojson,
        )

        self.assertEqual(len(features), 1)
        self.assertEqual(
            features[0]["geometry"]["coordinates"],
            [
                [121.0, 25.0],
                [121.001, 25.0],
                [121.002, 25.0004],
                [121.003, 25.001],
            ],
        )

    def test_build_ride_path_features_does_not_anchor_far_off_line_station_points(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0, 25.0035]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.001, 25.0]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.0, 25.0], [121.0005, 25.0], [121.001, 25.0]],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        features = build_ride_path_features(
            route_steps=[
                {
                    "kind": "ride",
                    "station_id": "station-a",
                    "line_id": "c2",
                    "next_station_id": "station-b",
                    "duration_sec": 60,
                }
            ],
            station_coords_by_id={
                "station-a": (121.0, 25.0035),
                "station-b": (121.001, 25.0),
            },
            stations_geojson=stations_geojson,
            lines_geojson=lines_geojson,
        )

        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["geometry"]["coordinates"][0], [121.0, 25.0])
        self.assertEqual(features[0]["geometry"]["coordinates"][-1], [121.001, 25.0])

    def test_build_geojson_segment_index_ignores_station_far_from_centerline(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0, 25.0]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.001, 25.0]},
                    "properties": {"id": "station-b", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0015, 25.003]},
                    "properties": {"id": "station-c", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.002, 25.0]},
                    "properties": {"id": "station-d", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.0, 25.0], [121.001, 25.0], [121.002, 25.0]],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        segment_index = _build_geojson_segment_index(
            stations_geojson,
            lines_geojson,
        )

        self.assertIn(("c2", "station-a", "station-b"), segment_index)
        self.assertIn(("c2", "station-b", "station-d"), segment_index)
        self.assertNotIn(("c2", "station-b", "station-c"), segment_index)
        self.assertEqual(
            segment_index[("c2", "station-b", "station-d")],
            [(121.001, 25.0), (121.002, 25.0)],
        )

    def test_build_geojson_segment_index_ignores_deleted_station_features(self):
        stations_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.0, 25.0]},
                    "properties": {"id": "station-a", "line_ids": ["c2"]},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.001, 25.0]},
                    "properties": {"id": "station-b", "line_ids": ["c2"], "deleted": True},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [121.002, 25.0]},
                    "properties": {"id": "station-c", "line_ids": ["c2"]},
                },
            ]
        )
        lines_geojson = _feature_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.0, 25.0], [121.001, 25.0], [121.002, 25.0]],
                    },
                    "properties": {"line_id": "c2", "line_name": "Red Line", "line_color": "#ff0000"},
                }
            ]
        )

        segment_index = _build_geojson_segment_index(
            stations_geojson,
            lines_geojson,
        )

        self.assertIn(("c2", "station-a", "station-c"), segment_index)
        self.assertNotIn(("c2", "station-a", "station-b"), segment_index)
        self.assertNotIn(("c2", "station-b", "station-c"), segment_index)


if __name__ == "__main__":
    unittest.main()
