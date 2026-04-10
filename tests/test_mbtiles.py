import gc
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.mbtiles import get_mbtiles_metadata
from app.services.mbtiles import read_mbtiles_tile
from app.services.mbtiles import _read_mbtiles_metadata


class MbtilesServiceTests(unittest.TestCase):
    def test_get_mbtiles_metadata_reads_bounds_and_zoom(self):
        mbtiles_path = self._create_mbtiles_file(
            metadata_rows=[
                ("name", "Taipei"),
                ("format", "png"),
                ("bounds", "121.45,24.95,121.66,25.21"),
                ("minzoom", "11"),
                ("maxzoom", "17"),
            ],
            tile_rows=[],
        )

        metadata = get_mbtiles_metadata(mbtiles_path)

        self.assertIsNotNone(metadata)
        self.assertTrue(metadata["enabled"])
        self.assertEqual(metadata["type"], "mbtiles_raster")
        self.assertEqual(metadata["format"], "png")
        self.assertEqual(metadata["media_type"], "image/png")
        self.assertEqual(metadata["minzoom"], 11)
        self.assertEqual(metadata["maxzoom"], 17)
        self.assertEqual(metadata["bounds"], [121.45, 24.95, 121.66, 25.21])

    def test_read_mbtiles_tile_converts_xyz_to_tms(self):
        z = 2
        x = 1
        y = 2
        tms_y = (1 << z) - 1 - y
        tile_bytes = b"png-tile"
        mbtiles_path = self._create_mbtiles_file(
            metadata_rows=[
                ("name", "Taipei"),
                ("format", "png"),
            ],
            tile_rows=[(z, x, tms_y, tile_bytes)],
        )

        tile = read_mbtiles_tile(mbtiles_path, z, x, y)

        self.assertIsNotNone(tile)
        self.assertEqual(tile[0], tile_bytes)
        self.assertEqual(tile[1], "image/png")

    def _create_mbtiles_file(
        self,
        metadata_rows: list[tuple[str, str]],
        tile_rows: list[tuple[int, int, int, bytes]],
    ) -> Path:
        handle = tempfile.NamedTemporaryFile(suffix=".mbtiles", delete=False)
        handle.close()
        path = Path(handle.name)

        with closing(sqlite3.connect(path)) as connection:
            connection.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
            connection.execute(
                """
                CREATE TABLE tiles (
                    zoom_level INTEGER,
                    tile_column INTEGER,
                    tile_row INTEGER,
                    tile_data BLOB
                )
                """
            )
            connection.executemany(
                "INSERT INTO metadata (name, value) VALUES (?, ?)",
                metadata_rows,
            )
            connection.executemany(
                """
                INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data)
                VALUES (?, ?, ?, ?)
                """,
                tile_rows,
            )
            connection.commit()

        self.addCleanup(lambda: self._cleanup_mbtiles_file(path))
        return path

    @staticmethod
    def _cleanup_mbtiles_file(path: Path) -> None:
        _read_mbtiles_metadata.cache_clear()
        for _ in range(5):
            try:
                path.unlink(missing_ok=True)
                return
            except PermissionError:
                gc.collect()
                time.sleep(0.05)
        path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
