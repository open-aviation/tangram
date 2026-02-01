from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated

from pydantic import TypeAdapter
from tangram_core.backend import to_frontend_manifest
from tangram_core.config import FrontendMutable


@dataclass
class Engine:
    max_thrust: int = 130_000


@dataclass
class Aircraft:
    engine: Engine = field(default_factory=Engine)


@dataclass
class Flight:
    aircraft: Aircraft = field(default_factory=Aircraft)
    num_pax: Annotated[int, FrontendMutable()] = 123


def test_frontend_config_nested() -> None:
    adapter = TypeAdapter(Flight)
    frontend_config = Flight()

    frontend_manifest = to_frontend_manifest(adapter, frontend_config)
    data = frontend_manifest["config"]

    assert "num_pax" in data
    assert data["num_pax"] == 123

    assert "aircraft" in data
    assert "engine" in data["aircraft"]
    assert data["aircraft"]["engine"]["max_thrust"] == 130_000

    props = frontend_manifest["config_json_schema"]["properties"]
    assert "num_pax" in props
    assert props["num_pax"].get("tangram_mutable") is True

    assert "aircraft" in props
    aircraft_schema = props["aircraft"]
    if "$ref" in aircraft_schema:
        ref_name = aircraft_schema["$ref"].split("/")[-1]
        aircraft_schema = frontend_manifest["config_json_schema"]["$defs"][ref_name]

    aircraft_props = aircraft_schema["properties"]
    assert "engine" in aircraft_props


@dataclass
class AircraftDetails:
    capacity: Annotated[int, FrontendMutable()] = 13


@dataclass
class WithUnion:
    aircraft: str | AircraftDetails = field(default_factory=AircraftDetails)


def test_frontend_config_union_anyof() -> None:
    instance = WithUnion()
    adapter = TypeAdapter(WithUnion)
    frontend_manifest = to_frontend_manifest(adapter, instance)
    data = frontend_manifest["config"]

    assert "aircraft" in data
    assert "capacity" in data["aircraft"]
    assert data["aircraft"]["capacity"] == 13

    # TODO: check schema


# TODO: Literal["xyz"] | bool fails on the frontend
