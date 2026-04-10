from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

from app.domain.models import RouteResult
from app.domain.models import RouteStep
from app.domain.models import SubwayNetwork


State = tuple[str, str]
Cost = tuple[int, int, int, int]


@dataclass(frozen=True)
class Edge:
    target: State
    cost: Cost
    kind: str
    duration_sec: int


class RouteEngine:
    def __init__(self, network: SubwayNetwork):
        self.network = network
        self.graph: dict[State, list[Edge]] = {}
        self._build_graph()

    def _build_graph(self) -> None:
        for station_line in self.network.station_lines:
            self.graph.setdefault((station_line.station_id, station_line.line_id), [])

        for segment in self.network.segments:
            forward = (segment.from_station_id, segment.line_id)
            backward = (segment.to_station_id, segment.line_id)
            if forward not in self.graph or backward not in self.graph:
                continue
            ride_cost = (segment.travel_sec, 0, 0, 1)
            self.graph[forward].append(
                Edge(
                    target=backward,
                    cost=ride_cost,
                    kind="ride",
                    duration_sec=segment.travel_sec,
                )
            )
            self.graph[backward].append(
                Edge(
                    target=forward,
                    cost=ride_cost,
                    kind="ride",
                    duration_sec=segment.travel_sec,
                )
            )

        for transfer in self.network.transfers:
            source = (transfer.station_id, transfer.from_line_id)
            target = (transfer.station_id, transfer.to_line_id)
            if source not in self.graph or target not in self.graph:
                continue
            self.graph[source].append(
                Edge(
                    target=target,
                    cost=(transfer.transfer_sec, 0, 1, 0),
                    kind="transfer",
                    duration_sec=transfer.transfer_sec,
                )
            )

        for walk_transfer in self.network.walk_transfers:
            source_line_ids = self.network.station_to_lines.get(walk_transfer.from_station_id)
            target_line_ids = self.network.station_to_lines.get(walk_transfer.to_station_id)
            if not source_line_ids or not target_line_ids:
                continue
            for source_line_id in sorted(source_line_ids):
                source = (walk_transfer.from_station_id, source_line_id)
                if source not in self.graph:
                    continue
                for target_line_id in sorted(target_line_ids):
                    target = (walk_transfer.to_station_id, target_line_id)
                    if target not in self.graph:
                        continue
                    self.graph[source].append(
                        Edge(
                            target=target,
                            cost=(walk_transfer.duration_sec, walk_transfer.duration_sec, 0, 0),
                            kind="walk",
                            duration_sec=walk_transfer.duration_sec,
                        )
                    )

        # Keep deterministic traversal order, but sort once at build-time
        # instead of sorting on every routing query.
        for edges in self.graph.values():
            edges.sort(
                key=lambda item: (
                    item.target[0],
                    item.target[1],
                    item.kind,
                    item.duration_sec,
                )
            )

    def find_route(self, start_station_id: str, end_station_id: str) -> RouteResult:
        if start_station_id not in self.network.stations:
            raise ValueError(f"Unknown start station: {start_station_id}")
        if end_station_id not in self.network.stations:
            raise ValueError(f"Unknown end station: {end_station_id}")
        if start_station_id == end_station_id:
            return RouteResult(
                total_time_sec=0,
                walking_time_sec=0,
                transfer_count=0,
                stop_count=0,
                station_ids=[start_station_id],
                line_sequence=[],
                steps=[],
            )

        start_states = [
            (start_station_id, line_id)
            for line_id in sorted(self.network.station_to_lines[start_station_id])
        ]
        goal_states = {
            (end_station_id, line_id)
            for line_id in self.network.station_to_lines[end_station_id]
        }

        heap: list[tuple[Cost, State]] = []
        distances: dict[State, Cost] = {}
        parents: dict[State, tuple[State | None, Edge | None]] = {}

        for state in start_states:
            distances[state] = (0, 0, 0, 0)
            parents[state] = (None, None)
            heapq.heappush(heap, ((0, 0, 0, 0), state))

        best_goal: State | None = None

        while heap:
            current_cost, state = heapq.heappop(heap)
            if current_cost != distances.get(state):
                continue
            if state in goal_states:
                best_goal = state
                break

            for edge in self.graph.get(state, []):
                next_cost = self._add_cost(current_cost, edge.cost)
                known_cost = distances.get(edge.target)
                if known_cost is None or next_cost < known_cost:
                    distances[edge.target] = next_cost
                    parents[edge.target] = (state, edge)
                    heapq.heappush(heap, (next_cost, edge.target))

        if best_goal is None:
            raise ValueError(f"No route found between {start_station_id} and {end_station_id}")

        return self._build_result(best_goal, distances[best_goal], parents)

    def find_route_through_stations(self, station_ids: list[str]) -> RouteResult:
        if len(station_ids) < 2:
            raise ValueError("At least two station ids are required")

        normalized_station_ids: list[str] = []
        for station_id in station_ids:
            if station_id not in self.network.stations:
                raise ValueError(f"Unknown station: {station_id}")
            if normalized_station_ids and station_id == normalized_station_ids[-1]:
                continue
            normalized_station_ids.append(station_id)

        if len(normalized_station_ids) == 1:
            station_id = normalized_station_ids[0]
            return RouteResult(
                total_time_sec=0,
                walking_time_sec=0,
                transfer_count=0,
                stop_count=0,
                station_ids=[station_id],
                line_sequence=[],
                steps=[],
            )

        legs: list[RouteResult] = []
        for start_station_id, end_station_id in zip(
            normalized_station_ids,
            normalized_station_ids[1:],
            strict=False,
        ):
            legs.append(self.find_route(start_station_id, end_station_id))

        return self._merge_leg_results(legs)

    def find_best_route_for_points(
        self,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        walking_seconds_per_pixel: float = 1.0,
        candidate_limit: int | None = None,
        max_station_walk_sec: int | None = 60,
        start_preferred_line_ids: list[str] | None = None,
        end_preferred_line_ids: list[str] | None = None,
        via_station_ids: list[str] | None = None,
    ) -> dict:
        ordered_via_station_ids = list(via_station_ids or [])
        for via_station_id in ordered_via_station_ids:
            if via_station_id not in self.network.stations:
                raise ValueError(f"Unknown via station: {via_station_id}")

        start_candidates = self._candidate_stations(
            start_x,
            start_y,
            walking_seconds_per_pixel,
            candidate_limit,
            max_station_walk_sec,
            prefer_nearest=True,
            preferred_line_ids=set(start_preferred_line_ids or []),
        )
        end_candidates = self._candidate_stations(
            end_x,
            end_y,
            walking_seconds_per_pixel,
            candidate_limit,
            max_station_walk_sec,
            prefer_nearest=True,
            preferred_line_ids=set(end_preferred_line_ids or []),
        )

        best_result: dict | None = None
        best_score: tuple[int, int, int, int] | None = None

        for start_station_id, start_distance in start_candidates:
            for end_station_id, end_distance in end_candidates:
                try:
                    route = self.find_route_through_stations(
                        [start_station_id, *ordered_via_station_ids, end_station_id]
                    )
                except ValueError:
                    continue

                if not any(step.kind == "ride" for step in route.steps):
                    continue

                access_time_sec = self._walking_time_sec(start_distance, walking_seconds_per_pixel)
                egress_time_sec = self._walking_time_sec(end_distance, walking_seconds_per_pixel)
                point_walking_time_sec = access_time_sec + egress_time_sec
                total_journey_time_sec = route.total_time_sec + point_walking_time_sec
                total_walking_time_sec = route.walking_time_sec + point_walking_time_sec
                score = (
                    total_journey_time_sec,
                    total_walking_time_sec,
                    route.transfer_count,
                    route.stop_count,
                )

                if best_score is None or score < best_score:
                    best_score = score
                    best_result = {
                        "start_point": {"x": start_x, "y": start_y},
                        "end_point": {"x": end_x, "y": end_y},
                        "selected_start_station": self._station_payload(start_station_id),
                        "selected_end_station": self._station_payload(end_station_id),
                        "via_stations": [
                            self._station_payload(station_id)
                            for station_id in ordered_via_station_ids
                        ],
                        "access_walk_distance_px": round(start_distance, 2),
                        "egress_walk_distance_px": round(end_distance, 2),
                        "access_walk_time_sec": access_time_sec,
                        "egress_walk_time_sec": egress_time_sec,
                        "total_journey_time_sec": total_journey_time_sec,
                        "route": route.to_dict(),
                    }

        if best_result is None:
            raise ValueError("No route found for the selected points")

        return best_result

    @staticmethod
    def _merge_leg_results(legs: list[RouteResult]) -> RouteResult:
        if not legs:
            raise ValueError("No route legs to merge")

        total_time_sec = 0
        walking_time_sec = 0
        transfer_count = 0
        stop_count = 0
        station_ids: list[str] = []
        line_sequence: list[str] = []
        steps: list[RouteStep] = []

        for index, leg in enumerate(legs):
            total_time_sec += leg.total_time_sec
            walking_time_sec += leg.walking_time_sec
            transfer_count += leg.transfer_count
            stop_count += leg.stop_count
            steps.extend(leg.steps)

            if index == 0:
                station_ids.extend(leg.station_ids)
            else:
                station_ids.extend(leg.station_ids[1:])

            for line_id in leg.line_sequence:
                if not line_sequence or line_sequence[-1] != line_id:
                    line_sequence.append(line_id)

        return RouteResult(
            total_time_sec=total_time_sec,
            walking_time_sec=walking_time_sec,
            transfer_count=transfer_count,
            stop_count=stop_count,
            station_ids=station_ids,
            line_sequence=line_sequence,
            steps=steps,
        )

    @staticmethod
    def _add_cost(left: Cost, right: Cost) -> Cost:
        return (
            left[0] + right[0],
            left[1] + right[1],
            left[2] + right[2],
            left[3] + right[3],
        )

    def _candidate_stations(
        self,
        x: float,
        y: float,
        walking_seconds_per_pixel: float,
        candidate_limit: int | None,
        max_station_walk_sec: int | None,
        prefer_nearest: bool,
        preferred_line_ids: set[str] | None = None,
    ) -> list[tuple[str, float]]:
        candidates = [
            (station.id, self._distance(x, y, station.x, station.y))
            for station in self.network.stations.values()
        ]
        candidates.sort(key=lambda item: (item[1], item[0]))
        base_candidates = candidates

        if max_station_walk_sec is not None:
            filtered = [
                candidate
                for candidate in candidates
                if self._walking_time_sec(candidate[1], walking_seconds_per_pixel) <= max_station_walk_sec
            ]
            if filtered:
                candidates = filtered

        if preferred_line_ids:
            preferred_candidates = [
                candidate
                for candidate in candidates
                if self.network.station_to_lines[candidate[0]] & preferred_line_ids
            ]
            if not preferred_candidates:
                preferred_candidates = [
                    candidate
                    for candidate in base_candidates
                    if self.network.station_to_lines[candidate[0]] & preferred_line_ids
                ]
            if preferred_candidates:
                candidates = preferred_candidates

        if prefer_nearest and candidates:
            return [candidates[0]]

        if candidate_limit is None or candidate_limit <= 0:
            return candidates
        return candidates[:candidate_limit]

    def _station_payload(self, station_id: str) -> dict:
        station = self.network.stations[station_id]
        return {
            "id": station.id,
            "name": station.name,
            "x": station.x,
            "y": station.y,
            "line_ids": sorted(self.network.station_to_lines[station.id]),
        }

    @staticmethod
    def _distance(x1: float, y1: float, x2: float, y2: float) -> float:
        return math.hypot(x2 - x1, y2 - y1)

    @staticmethod
    def _walking_time_sec(distance_px: float, walking_seconds_per_pixel: float) -> int:
        return int(round(distance_px * walking_seconds_per_pixel))

    def _build_result(
        self,
        goal_state: State,
        total_cost: Cost,
        parents: dict[State, tuple[State | None, Edge | None]],
    ) -> RouteResult:
        states: list[State] = []
        steps: list[RouteStep] = []
        current: State | None = goal_state

        while current is not None:
            previous, edge = parents[current]
            states.append(current)
            if previous is not None and edge is not None:
                steps.append(
                    RouteStep(
                        kind=edge.kind,
                        station_id=previous[0],
                        line_id=previous[1],
                        next_station_id=current[0],
                        duration_sec=edge.duration_sec,
                    )
                )
            current = previous

        states.reverse()
        steps.reverse()

        station_ids = [states[0][0]]
        for step in steps:
            if step.next_station_id and step.next_station_id != station_ids[-1]:
                station_ids.append(step.next_station_id)

        return RouteResult(
            total_time_sec=total_cost[0],
            walking_time_sec=total_cost[1],
            transfer_count=total_cost[2],
            stop_count=total_cost[3],
            station_ids=station_ids,
            line_sequence=self._extract_line_sequence(states, steps),
            steps=steps,
        )

    @staticmethod
    def _extract_line_sequence(states: list[State], steps: list[RouteStep]) -> list[str]:
        sequence: list[str] = []
        current_line: str | None = None

        for state, step in zip(states, steps, strict=False):
            if step.kind != "ride":
                continue
            if state[1] != current_line:
                sequence.append(state[1])
                current_line = state[1]

        if steps and steps[-1].kind == "ride":
            last_line = states[-1][1]
            if not sequence or sequence[-1] != last_line:
                sequence.append(last_line)

        return sequence
