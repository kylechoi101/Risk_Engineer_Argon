"""Request models for the HTTP API. See docs/api.md."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from argon.data.geo import ORIGIN, distance_m

MAX_CENTER_OFFSET_M = 500


class Center(BaseModel):
    lat: float = ORIGIN[0]
    lon: float = ORIGIN[1]
    label: str | None = "Ferry Building"


class Earthquake(BaseModel):
    type: Literal["earthquake"]
    magnitude: float = Field(ge=5.5, le=8.0)


class KingTide(BaseModel):
    type: Literal["king_tide"]
    water_level_ft_mllw: float = Field(ge=0, le=15)


class StormSurge(BaseModel):
    type: Literal["storm_surge"]
    surge_ft: float = Field(ge=0, le=13)


Hazard = Annotated[Earthquake | KingTide | StormSurge, Field(discriminator="type")]


class RunRequest(BaseModel):
    center: Center = Field(default_factory=Center)
    radius_mi: float = Field(1.0, ge=0.25, le=1.5)
    hazards: list[Hazard] = Field(default_factory=list)
    prompt: str | None = Field(None, max_length=2000)
    budget_m: float = Field(150, gt=0, le=10_000)
    seed: int = Field(42, ge=0, le=2**32 - 1)
    iterations: int = Field(4096, ge=100, le=50_000)
    max_fixes: int = Field(30, ge=1, le=30)

    @model_validator(mode="before")
    @classmethod
    def expand_scenario_shorthand(cls, data):
        if isinstance(data, dict) and isinstance(data.get("scenario"), dict):
            data = dict(data)
            scenario = data.pop("scenario")
            hazards = list(data.get("hazards") or [])
            if "magnitude" in scenario:
                hazards.append({"type": "earthquake", "magnitude": scenario["magnitude"]})
            if "king_tide_ft" in scenario:
                hazards.append({"type": "king_tide",
                                "water_level_ft_mllw": scenario["king_tide_ft"]})
            data["hazards"] = hazards
        return data

    @field_validator("center")
    @classmethod
    def center_near_ferry_building(cls, center: Center) -> Center:
        if distance_m(ORIGIN, (center.lat, center.lon)) > MAX_CENTER_OFFSET_M:
            raise ValueError("center must be within 500 m of the Ferry Building (37.7955, -122.3937)")
        return center

    @model_validator(mode="after")
    def check_hazards(self):
        types = [h.type for h in self.hazards]
        if len(types) != len(set(types)):
            raise ValueError("at most one hazard of each type")
        if "earthquake" not in types and not self.prompt:
            raise ValueError("an earthquake hazard is required (or a prompt that names one)")
        return self


class SimulateRequest(BaseModel):
    run_id: str
    selected_fix_ids: list[str] = Field(default_factory=list)
    budget_m: float | None = Field(None, gt=0, le=10_000)
