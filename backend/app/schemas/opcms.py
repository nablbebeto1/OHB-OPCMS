from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserSummary(BaseModel):
    id: UUID
    username: str
    email: str
    full_name: str
    role_code: str
    role_name: str
    is_read_only: bool
    region_id: Optional[UUID] = None
    zone_id: Optional[UUID] = None
    woreda_id: Optional[UUID] = None
    zone_name: Optional[str] = None
    woreda_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSummary


class ZoneCreate(BaseModel):
    region_id: UUID
    code: str
    name: str
    zone_type: str = "Zone"
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class WoredaCreate(BaseModel):
    zone_id: UUID
    reporting_unit_code: str
    name: str
    has_security_constraints: bool = False
    total_planned_target: int = Field(ge=0)


class CampaignCreate(BaseModel):
    code: str
    name: str
    round_number: int = 1
    vaccine_types: str = "nOPV2 + bOPV Co-administration"
    nopv2_doses_per_vial: int = 50
    bopv_doses_per_vial: int = 20
    core_target_days_divisor: int = 4
    total_campaign_days: int = 6
    start_date: date
    end_date: date
    region_id: UUID


class AgeGroupInput(BaseModel):
    age_group: str  # 0-11m, 12-59m, 60-120m
    vaccinated_before: int = Field(ge=0, default=0)
    not_vaccinated_before: int = Field(ge=0, default=0)


class VaccineUtilInput(BaseModel):
    vaccine_type: str  # nOPV2, bOPV
    vials_received: int = Field(ge=0, default=0)
    vials_used: int = Field(ge=0, default=0)
    vials_partially_used: int = Field(ge=0, default=0)
    vials_returned_unused_good: int = Field(ge=0, default=0)
    vials_broken: int = Field(ge=0, default=0)
    vials_returned_bad_stage_3_4: int = Field(ge=0, default=0)
    vials_lost: int = Field(ge=0, default=0)


class DailyReportPayload(BaseModel):
    campaign_day_id: UUID
    woreda_id: UUID
    age_groups: List[AgeGroupInput]
    vaccine_utilizations: List[VaccineUtilInput]
    afp_alerts_count: int = Field(ge=0, default=0)
    aefi_alerts_count: int = Field(ge=0, default=0)
    hhs_visited: int = Field(ge=0, default=0)
    community_meeting_participants: int = Field(ge=0, default=0)
    home_to_home_ipc_reached: int = Field(ge=0, default=0)
    zero_dose_identified: int = Field(ge=0, default=0)
    zero_dose_vaccinated: int = Field(ge=0, default=0)
    under_vaccinated_identified: int = Field(ge=0, default=0)
    under_vaccinated_vaccinated: int = Field(ge=0, default=0)
    total_teams: int = Field(ge=0, default=0)
    teams_reported: int = Field(ge=0, default=0)
    any_remark: Optional[str] = None


class WorkflowTransitionRequest(BaseModel):
    comment: Optional[str] = None


class DiscrepancyResolutionRequest(BaseModel):
    ohb_approval_status: str  # Approved Correction, Keep As-Is, Deferred
    resolution_notes: str
