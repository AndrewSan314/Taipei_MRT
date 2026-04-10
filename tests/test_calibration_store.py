import json
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.calibration_store import save_station_positions


class CalibrationStoreTests(unittest.TestCase):
    def test_save_station_positions_updates_only_selected_stations(self):
        sample = {
            "stations": [
                {"id": "A", "name": "Alpha", "x": 10, "y": 20},
                {"id": "B", "name": "Beta", "x": 30, "y": 40},
            ],
            "lines": [{"id": "red", "name": "Red Line", "color": "#f00"}],
            "station_lines": [],
            "segments": [],
            "transfers": [],
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = Path(tmp_dir) / "network.json"
            file_path.write_text(json.dumps(sample), encoding="utf-8")

            updated = save_station_positions(
                file_path,
                {
                    "A": {"x": 111, "y": 222},
                },
            )

            self.assertEqual(updated, 1)

            persisted = json.loads(file_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["stations"][0]["x"], 111)
            self.assertEqual(persisted["stations"][0]["y"], 222)
            self.assertEqual(persisted["stations"][1]["x"], 30)
            self.assertEqual(persisted["stations"][1]["y"], 40)


if __name__ == "__main__":
    unittest.main()
