import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.taipei_geojson_builder import is_subway_route_feature
from app.services.taipei_geojson_builder import is_walkable_line_feature
from app.services.taipei_geojson_builder import normalize_station_name
from app.services.taipei_geojson_builder import parse_other_tags
from app.services.taipei_geojson_builder import station_name_candidates
from app.services.taipei_geojson_builder import _build_station_feature_collection
from app.services.taipei_geojson_builder import _to_subway_line_feature


class TaipeiGeojsonBuilderTests(unittest.TestCase):
    def test_parse_other_tags_extracts_key_values(self):
        parsed = parse_other_tags(
            '"name:en"=>"Taipei City Hall","route"=>"subway","ref"=>"BL"'
        )

        self.assertEqual(parsed["name:en"], "Taipei City Hall")
        self.assertEqual(parsed["route"], "subway")
        self.assertEqual(parsed["ref"], "BL")

    def test_station_name_candidates_strip_exit_markup(self):
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [121.0, 25.0]},
            "properties": {
                "name": "捷運市政府站2號出口",
                "other_tags": '"name:en"=>"MRT Taipei City Hall Station Exit 2","railway"=>"subway_entrance"',
            },
        }

        candidates = station_name_candidates(feature)

        self.assertIn("Taipei City Hall", candidates)
        self.assertIn("捷運市政府站", candidates)

    def test_is_subway_route_feature_accepts_subway_relation(self):
        feature = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {
                "name": "南港-板橋-土城線",
                "other_tags": '"route"=>"subway","ref"=>"BL","network"=>"臺北捷運"',
            },
        }

        self.assertTrue(is_subway_route_feature(feature))

    def test_is_subway_route_feature_accepts_light_rail_and_tram_relations(self):
        light_rail = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {
                "name": "Danhai LRT",
                'other_tags': '"route"=>"light_rail","ref"=>"V","network"=>"淡海輕軌"',
            },
        }
        tram = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {
                "name": "Maokong Gondola",
                'other_tags': '"route"=>"tram","ref"=>"貓空纜車"',
            },
        }

        self.assertTrue(is_subway_route_feature(light_rail))
        self.assertTrue(is_subway_route_feature(tram))

    def test_is_subway_route_feature_rejects_bus_relation(self):
        feature = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {
                "name": "臺北市 307",
                "other_tags": '"route"=>"bus","ref"=>"307"',
            },
        }

        self.assertFalse(is_subway_route_feature(feature))

    def test_is_walkable_line_feature_accepts_city_street_and_rejects_motorway(self):
        residential = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {"highway": "residential", "railway": None, "waterway": None},
        }
        motorway = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {"highway": "motorway", "railway": None, "waterway": None},
        }

        self.assertTrue(is_walkable_line_feature(residential))
        self.assertFalse(is_walkable_line_feature(motorway))

    def test_normalize_station_name_handles_common_legacy_variants(self):
        self.assertEqual(normalize_station_name("MRT Taipei City Hall Station Exit 2"), "taipei city hall")
        self.assertEqual(normalize_station_name("Minquan W. Road"), "minquan west road")

    def test_to_subway_line_feature_assigns_network_line_id_for_light_rail(self):
        feature = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": []},
            "properties": {
                "name": "Ankeng Light Rail",
                'other_tags': '"route"=>"light_rail","ref"=>"K","network"=>"新北捷運","colour"=>"#c3b091"',
            },
        }

        built = _to_subway_line_feature(feature, {"c10": {"color": "#d6cfba"}})

        self.assertEqual(built["properties"]["line_id"], "c10")
        self.assertEqual(built["properties"]["line_color"], "#d6cfba")

    def test_build_station_feature_collection_snaps_station_to_owned_line(self):
        station_candidates = {
            "daan-park": [
                {
                    "coordinate": (121.001, 25.00045),
                    "name": "Daan Park",
                    "tags": {},
                }
            ]
        }
        network_station_by_id = {
            "daan-park": {
                "id": "daan-park",
                "name": "Daan Park",
                "line_ids": ["c2"],
            }
        }
        line_features = [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[121.0, 25.0], [121.01, 25.0]],
                },
                "properties": {"line_id": "c2"},
            }
        ]

        payload = _build_station_feature_collection(
            network_station_by_id,
            station_candidates,
            line_features,
        )

        self.assertEqual(payload["features"][0]["geometry"]["coordinates"], [121.001, 25.0])


if __name__ == "__main__":
    unittest.main()
