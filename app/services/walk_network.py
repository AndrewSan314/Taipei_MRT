from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from dataclasses import field
from typing import Any


Coordinate = tuple[float, float]
CellId = tuple[int, int]
DEFAULT_GRID_TARGET_NODES_PER_CELL = 64
MIN_GRID_CELL_SIZE_DEG = 1e-4


@dataclass(frozen=True)
class StationAccessPoint:
    station_id: str
    coordinate: Coordinate
    name: str | None = None


@dataclass(frozen=True)
class WalkPathResult:
    station_id: str
    distance_m: float
    path_coordinates: list[Coordinate]
    access_point_coordinate: Coordinate
    snapped_start_coordinate: Coordinate
    access_point_name: str | None = None


@dataclass
class WalkGraph:
    adjacency: dict[Coordinate, list[tuple[Coordinate, float]]]
    snapped_node_cache: dict[Coordinate, Coordinate] = field(default_factory=dict)
    spatial_index: dict[CellId, list[Coordinate]] = field(default_factory=dict)
    grid_origin: Coordinate = (0.0, 0.0)
    grid_cell_size: Coordinate = (MIN_GRID_CELL_SIZE_DEG, MIN_GRID_CELL_SIZE_DEG)
    grid_bounds: tuple[int, int, int, int] = (0, 0, 0, 0)

    def __post_init__(self) -> None:
        if self.adjacency and not self.spatial_index:
            (
                self.spatial_index,
                self.grid_origin,
                self.grid_cell_size,
                self.grid_bounds,
            ) = _build_spatial_index(self.adjacency)

    @property
    def nodes(self) -> tuple[Coordinate, ...]:
        return tuple(self.adjacency.keys())

    def nearest_node(self, lon: float, lat: float) -> Coordinate:
        if not self.adjacency:
            raise ValueError("Walk graph has no nodes")

        point = (float(lon), float(lat))
        if point in self.adjacency:
            return point

        cached_node = self.snapped_node_cache.get(point)
        if cached_node is not None:
            return cached_node

        query_cell = self._cell_id(*point)
        search_center_cell = self._clamp_cell_to_bounds(query_cell)
        min_cell_x, max_cell_x, min_cell_y, max_cell_y = self.grid_bounds
        max_ring = max(
            abs(search_center_cell[0] - min_cell_x),
            abs(search_center_cell[0] - max_cell_x),
            abs(search_center_cell[1] - min_cell_y),
            abs(search_center_cell[1] - max_cell_y),
        )

        best_node: Coordinate | None = None
        best_distance_m = float("inf")
        for ring in range(max_ring + 1):
            for cell_id in self._iter_cells_for_ring(search_center_cell, ring):
                for node_lon, node_lat in self.spatial_index.get(cell_id, []):
                    distance_m = haversine_distance_m(lat, lon, node_lat, node_lon)
                    if distance_m < best_distance_m:
                        best_distance_m = distance_m
                        best_node = (node_lon, node_lat)

            if best_node is None:
                continue
            if ring == max_ring:
                break
            if best_distance_m <= self._min_outside_ring_distance_m(*point, search_center_cell, ring):
                break

        if best_node is None:
            for node_lon, node_lat in self.adjacency.keys():
                distance_m = haversine_distance_m(lat, lon, node_lat, node_lon)
                if distance_m < best_distance_m:
                    best_distance_m = distance_m
                    best_node = (node_lon, node_lat)

        if best_node is None:
            raise ValueError("Unable to snap point to walk graph")
        self.snapped_node_cache[point] = best_node
        return best_node

    def _cell_id(self, lon: float, lat: float) -> CellId:
        origin_lon, origin_lat = self.grid_origin
        cell_size_lon, cell_size_lat = self.grid_cell_size
        return (
            math.floor((float(lon) - origin_lon) / cell_size_lon),
            math.floor((float(lat) - origin_lat) / cell_size_lat),
        )

    def _iter_cells_for_ring(self, center_cell: CellId, ring: int):
        center_x, center_y = center_cell
        if ring == 0:
            yield center_cell
            return

        min_x = center_x - ring
        max_x = center_x + ring
        min_y = center_y - ring
        max_y = center_y + ring

        for cell_x in range(min_x, max_x + 1):
            yield (cell_x, min_y)
            yield (cell_x, max_y)
        for cell_y in range(min_y + 1, max_y):
            yield (min_x, cell_y)
            yield (max_x, cell_y)

    def _clamp_cell_to_bounds(self, cell_id: CellId) -> CellId:
        cell_x, cell_y = cell_id
        min_cell_x, max_cell_x, min_cell_y, max_cell_y = self.grid_bounds
        return (
            min(max(cell_x, min_cell_x), max_cell_x),
            min(max(cell_y, min_cell_y), max_cell_y),
        )

    def _min_outside_ring_distance_m(
        self,
        lon: float,
        lat: float,
        center_cell: CellId,
        ring: int,
    ) -> float:
        center_x, center_y = center_cell
        origin_lon, origin_lat = self.grid_origin
        cell_size_lon, cell_size_lat = self.grid_cell_size
        min_cell_x, max_cell_x, min_cell_y, max_cell_y = self.grid_bounds

        west_boundary_lon = origin_lon + (center_x - ring) * cell_size_lon
        east_boundary_lon = origin_lon + (center_x + ring + 1) * cell_size_lon
        south_boundary_lat = origin_lat + (center_y - ring) * cell_size_lat
        north_boundary_lat = origin_lat + (center_y + ring + 1) * cell_size_lat

        candidate_bounds_m: list[float] = []
        if center_x - ring > min_cell_x:
            candidate_bounds_m.append(haversine_distance_m(lat, lon, lat, west_boundary_lon))
        if center_x + ring < max_cell_x:
            candidate_bounds_m.append(haversine_distance_m(lat, lon, lat, east_boundary_lon))
        if center_y - ring > min_cell_y:
            candidate_bounds_m.append(haversine_distance_m(lat, lon, south_boundary_lat, lon))
        if center_y + ring < max_cell_y:
            candidate_bounds_m.append(haversine_distance_m(lat, lon, north_boundary_lat, lon))

        if not candidate_bounds_m:
            return float("inf")
        return min(candidate_bounds_m)


def build_walk_graph(walk_network_geojson: dict[str, Any] | None) -> WalkGraph:
    adjacency: dict[Coordinate, list[tuple[Coordinate, float]]] = {}
    if not _is_valid_geojson(walk_network_geojson):
        return WalkGraph(adjacency={})

    for feature in walk_network_geojson.get("features", []):
        geometry = feature.get("geometry", {}) or {}
        for line in _iter_line_strings(geometry):
            for start, end in zip(line, line[1:], strict=False):
                if start == end:
                    continue
                distance_m = haversine_distance_m(start[1], start[0], end[1], end[0])
                adjacency.setdefault(start, []).append((end, distance_m))
                adjacency.setdefault(end, []).append((start, distance_m))

    return WalkGraph(adjacency=adjacency)


def _build_spatial_index(
    adjacency: dict[Coordinate, list[tuple[Coordinate, float]]],
) -> tuple[dict[CellId, list[Coordinate]], Coordinate, Coordinate, tuple[int, int, int, int]]:
    nodes = tuple(adjacency.keys())
    min_lon = min(node[0] for node in nodes)
    max_lon = max(node[0] for node in nodes)
    min_lat = min(node[1] for node in nodes)
    max_lat = max(node[1] for node in nodes)

    axis_cell_count = max(
        1,
        math.ceil(math.sqrt(len(nodes) / DEFAULT_GRID_TARGET_NODES_PER_CELL)),
    )
    cell_size_lon = max((max_lon - min_lon) / axis_cell_count, MIN_GRID_CELL_SIZE_DEG)
    cell_size_lat = max((max_lat - min_lat) / axis_cell_count, MIN_GRID_CELL_SIZE_DEG)
    origin = (min_lon, min_lat)
    cell_size = (cell_size_lon, cell_size_lat)

    spatial_index: dict[CellId, list[Coordinate]] = {}
    min_cell_x = max_cell_x = min_cell_y = max_cell_y = 0
    for index, node in enumerate(nodes):
        cell_x = math.floor((node[0] - origin[0]) / cell_size_lon)
        cell_y = math.floor((node[1] - origin[1]) / cell_size_lat)
        spatial_index.setdefault((cell_x, cell_y), []).append(node)
        if index == 0:
            min_cell_x = max_cell_x = cell_x
            min_cell_y = max_cell_y = cell_y
            continue
        min_cell_x = min(min_cell_x, cell_x)
        max_cell_x = max(max_cell_x, cell_x)
        min_cell_y = min(min_cell_y, cell_y)
        max_cell_y = max(max_cell_y, cell_y)

    return spatial_index, origin, cell_size, (min_cell_x, max_cell_x, min_cell_y, max_cell_y)


def extract_station_access_points(
    station_access_points_geojson: dict[str, Any] | None,
    station_coords_by_id: dict[str, Coordinate],
) -> list[StationAccessPoint]:
    if _is_valid_geojson(station_access_points_geojson):
        points: list[StationAccessPoint] = []
        for feature in station_access_points_geojson.get("features", []):
            station_id = feature.get("properties", {}).get("station_id")
            coordinates = feature.get("geometry", {}).get("coordinates")
            if (
                not station_id
                or station_id not in station_coords_by_id
                or not isinstance(coordinates, list)
                or len(coordinates) < 2
            ):
                continue
            points.append(
                StationAccessPoint(
                    station_id=str(station_id),
                    coordinate=(float(coordinates[0]), float(coordinates[1])),
                    name=feature.get("properties", {}).get("name"),
                )
            )
        if points:
            return points

    return [
        StationAccessPoint(
            station_id=station_id,
            coordinate=(station_lon, station_lat),
        )
        for station_id, (station_lon, station_lat) in station_coords_by_id.items()
    ]


def find_nearest_station_by_walk(
    lon: float,
    lat: float,
    station_coords_by_id: dict[str, Coordinate],
    station_access_points_geojson: dict[str, Any] | None,
    walk_network_geojson: dict[str, Any] | None,
    walk_graph: WalkGraph | None = None,
    targets_by_node: dict[Coordinate, list[StationAccessPoint]] | None = None,
) -> WalkPathResult:
    if not station_coords_by_id:
        raise ValueError("No GIS stations available")

    graph = walk_graph or build_walk_graph(walk_network_geojson)
    if not graph.adjacency:
        station_id, distance_m = _nearest_station_by_distance(lon, lat, station_coords_by_id)
        station_coordinate = station_coords_by_id[station_id]
        return WalkPathResult(
            station_id=station_id,
            distance_m=distance_m,
            path_coordinates=[(lon, lat), station_coordinate],
            access_point_coordinate=station_coordinate,
            snapped_start_coordinate=(lon, lat),
        )

    access_points = extract_station_access_points(
        station_access_points_geojson,
        station_coords_by_id,
    )
    if not access_points:
        station_id, distance_m = _nearest_station_by_distance(lon, lat, station_coords_by_id)
        station_coordinate = station_coords_by_id[station_id]
        return WalkPathResult(
            station_id=station_id,
            distance_m=distance_m,
            path_coordinates=[(lon, lat), station_coordinate],
            access_point_coordinate=station_coordinate,
            snapped_start_coordinate=(lon, lat),
        )

    start_node = graph.nearest_node(lon, lat)
    if targets_by_node is None:
        targets_by_node = {}
        for access_point in access_points:
            access_node = graph.nearest_node(*access_point.coordinate)
            targets_by_node.setdefault(access_node, []).append(access_point)

    best_distance_m, previous_nodes, target_node = _dijkstra_to_targets(graph, start_node, set(targets_by_node))
    if target_node is None:
        station_id, distance_m = _nearest_station_by_distance(lon, lat, station_coords_by_id)
        station_coordinate = station_coords_by_id[station_id]
        return WalkPathResult(
            station_id=station_id,
            distance_m=distance_m,
            path_coordinates=[(lon, lat), station_coordinate],
            access_point_coordinate=station_coordinate,
            snapped_start_coordinate=(lon, lat),
        )

    chosen_access = sorted(
        targets_by_node[target_node],
        key=lambda item: (
            item.station_id,
            item.coordinate[0],
            item.coordinate[1],
        ),
    )[0]
    path_coordinates = _reconstruct_path(previous_nodes, start_node, target_node)
    return WalkPathResult(
        station_id=chosen_access.station_id,
        distance_m=best_distance_m,
        path_coordinates=path_coordinates,
        access_point_coordinate=target_node,
        snapped_start_coordinate=start_node,
        access_point_name=chosen_access.name,
    )


def build_walk_targets_by_node(
    walk_graph: WalkGraph,
    station_access_points_geojson: dict[str, Any] | None,
    station_coords_by_id: dict[str, Coordinate],
) -> dict[Coordinate, list[StationAccessPoint]]:
    access_points = extract_station_access_points(
        station_access_points_geojson,
        station_coords_by_id,
    )
    targets_by_node: dict[Coordinate, list[StationAccessPoint]] = {}
    for access_point in access_points:
        if walk_graph.adjacency:
            access_node = walk_graph.nearest_node(*access_point.coordinate)
        else:
            access_node = access_point.coordinate
        targets_by_node.setdefault(access_node, []).append(access_point)
    return targets_by_node


def _dijkstra_to_targets(
    graph: WalkGraph,
    start_node: Coordinate,
    target_nodes: set[Coordinate],
) -> tuple[float, dict[Coordinate, Coordinate], Coordinate | None]:
    if start_node in target_nodes:
        return 0.0, {}, start_node

    distances: dict[Coordinate, float] = {start_node: 0.0}
    previous_nodes: dict[Coordinate, Coordinate] = {}
    queue: list[tuple[float, Coordinate]] = [(0.0, start_node)]

    while queue:
        current_distance, current_node = heapq.heappop(queue)
        if current_distance > distances.get(current_node, float("inf")):
            continue
        if current_node in target_nodes:
            return current_distance, previous_nodes, current_node

        for neighbor_node, edge_distance_m in graph.adjacency.get(current_node, []):
            candidate_distance = current_distance + edge_distance_m
            if candidate_distance >= distances.get(neighbor_node, float("inf")):
                continue
            distances[neighbor_node] = candidate_distance
            previous_nodes[neighbor_node] = current_node
            heapq.heappush(queue, (candidate_distance, neighbor_node))

    return float("inf"), previous_nodes, None


def _reconstruct_path(
    previous_nodes: dict[Coordinate, Coordinate],
    start_node: Coordinate,
    target_node: Coordinate,
) -> list[Coordinate]:
    path = [target_node]
    cursor = target_node
    while cursor != start_node:
        cursor = previous_nodes[cursor]
        path.append(cursor)
    path.reverse()
    return path


def _iter_line_strings(geometry: dict[str, Any]) -> list[list[Coordinate]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, list):
        line = [
            (float(point[0]), float(point[1]))
            for point in coordinates
            if isinstance(point, list) and len(point) >= 2
        ]
        return [line] if len(line) >= 2 else []
    if geometry_type == "MultiLineString" and isinstance(coordinates, list):
        lines: list[list[Coordinate]] = []
        for line in coordinates:
            if not isinstance(line, list):
                continue
            parsed_line = [
                (float(point[0]), float(point[1]))
                for point in line
                if isinstance(point, list) and len(point) >= 2
            ]
            if len(parsed_line) >= 2:
                lines.append(parsed_line)
        return lines
    return []


def _is_valid_geojson(payload: dict[str, Any] | None) -> bool:
    return (
        isinstance(payload, dict)
        and payload.get("type") == "FeatureCollection"
        and isinstance(payload.get("features"), list)
    )


def _nearest_station_by_distance(
    lon: float,
    lat: float,
    station_coords_by_id: dict[str, Coordinate],
) -> tuple[str, float]:
    best_station_id: str | None = None
    best_distance_m = float("inf")

    for station_id, (station_lon, station_lat) in station_coords_by_id.items():
        distance_m = haversine_distance_m(lat, lon, station_lat, station_lon)
        if distance_m < best_distance_m:
            best_distance_m = distance_m
            best_station_id = station_id

    if best_station_id is None:
        raise ValueError("No GIS stations available")
    return best_station_id, best_distance_m


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000.0
    rad_lat1 = math.radians(lat1)
    rad_lon1 = math.radians(lon1)
    rad_lat2 = math.radians(lat2)
    rad_lon2 = math.radians(lon2)
    delta_lat = rad_lat2 - rad_lat1
    delta_lon = rad_lon2 - rad_lon1

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(rad_lat1) * math.cos(rad_lat2) * (math.sin(delta_lon / 2) ** 2)
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1 - a)))
    return earth_radius_m * c
