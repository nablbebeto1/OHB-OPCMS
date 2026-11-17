from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, joinedload

from app.core.security import (
    RoleCode,
    assert_woreda_scope,
    create_access_token,
    get_current_user,
    require_roles,
    verify_password,
)
from app.db.session import get_db
from app.models import (
    AdministrativeTarget,
    AfpAefiAlert,
    AgeGroupVaccinationRecord,
    AuditLog,
    Campaign,
    CampaignDay,
    DailyVaccinationReport,
    FormulaDiscrepancy,
    Notification,
    Region,
    ReportSubmissionHistory,
    Role,
    SocialMobilizationRecord,
    UnderVaccinatedRecord,
    User,
    VaccinationTeam,
    VaccineUtilizationRecord,
    Woreda,
    ZeroDoseRecord,
    Zone,
)
from app.schemas.opcms import (
    CampaignCreate,
    DailyReportPayload,
    DiscrepancyResolutionRequest,
    LoginRequest,
    TokenResponse,
    UserSummary,
    WoredaCreate,
    WorkflowTransitionRequest,
    ZoneCreate,
)

from app.api.v1.command_and_admin import command_router
from app.api.v1.imports_and_calc import ext_router
from app.api.v1.monitoring_gis_alerts import monitoring_router

api_router = APIRouter()
api_router.include_router(ext_router)
api_router.include_router(monitoring_router)
api_router.include_router(command_router)


def log_audit(db: Session, user: User, action: str, entity_type: str, entity_id: str, details: Optional[dict] = None, ip: Optional[str] = None):
    db.add(
        AuditLog(
            actor_user_id=user.id,
            actor_username=user.username,
            actor_role=user.role.code,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
            ip_address=ip,
        )
    )


def serialize_user(user: User) -> UserSummary:
    return UserSummary(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        role_code=user.role.code,
        role_name=user.role.name,
        is_read_only=user.role.is_read_only,
        region_id=user.region_id,
        zone_id=user.zone_id,
        woreda_id=user.woreda_id,
        zone_name=user.zone.name if user.zone else None,
        woreda_name=user.woreda.name if user.woreda else None,
    )


@api_router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.zone), joinedload(User.woreda))
        .filter(User.username == payload.username, User.is_active.is_(True))
        .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

    user.last_login_at = datetime.now(timezone.utc)
    log_audit(db, user, "LOGIN", "User", str(user.id), ip=request.client.host if request.client else None)
    db.commit()

    token = create_access_token(user.id, user.role.code)
    return TokenResponse(access_token=token, user=serialize_user(user))


@api_router.get("/auth/me", response_model=UserSummary)
def get_me(current_user: User = Depends(get_current_user)):
    return serialize_user(current_user)


@api_router.get("/roles")
def list_roles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Role).all()


@api_router.get("/hierarchy/overview")
def get_hierarchy(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    regions = db.query(Region).all()
    zone_query = db.query(Zone)
    woreda_query = db.query(Woreda)

    if current_user.role.code == RoleCode.ZONE_ADMIN and current_user.zone_id:
        zone_query = zone_query.filter(Zone.id == current_user.zone_id)
        woreda_query = woreda_query.filter(Woreda.zone_id == current_user.zone_id)
    elif current_user.role.code == RoleCode.WOREDA_OFFICER and current_user.woreda_id:
        woreda_query = woreda_query.filter(Woreda.id == current_user.woreda_id)
        zone_query = zone_query.filter(Zone.id == current_user.zone_id)

    return {
        "regions": regions,
        "zones": zone_query.order_by(Zone.name).all(),
        "woredas": woreda_query.order_by(Woreda.source_sn, Woreda.name).all(),
    }


@api_router.post("/hierarchy/zones", status_code=status.HTTP_201_CREATED)
def create_zone(
    payload: ZoneCreate,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN])),
    db: Session = Depends(get_db),
):
    zone = Zone(
        region_id=payload.region_id,
        code=payload.code,
        name=payload.name,
        normalized_name=payload.name.strip().lower(),
        zone_type=payload.zone_type,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    db.add(zone)
    db.flush()
    log_audit(db, current_user, "CREATE_ZONE", "Zone", str(zone.id), {"name": zone.name})
    db.commit()
    db.refresh(zone)
    return zone


@api_router.post("/hierarchy/woredas", status_code=status.HTTP_201_CREATED)
def create_woreda(
    payload: WoredaCreate,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN])),
    db: Session = Depends(get_db),
):
    woreda = Woreda(
        zone_id=payload.zone_id,
        reporting_unit_code=payload.reporting_unit_code,
        name=payload.name,
        has_security_constraints=payload.has_security_constraints,
    )
    db.add(woreda)
    db.flush()
    active_campaign = db.query(Campaign).filter(Campaign.status == "Active").first()
    if active_campaign:
        db.add(
            AdministrativeTarget(
                campaign_id=active_campaign.id,
                woreda_id=woreda.id,
                total_planned_target=payload.total_planned_target,
                daily_target=round(payload.total_planned_target / max(1, active_campaign.core_target_days_divisor)),
                source_reference="Manual Admin Entry",
            )
        )
    log_audit(db, current_user, "CREATE_WOREDA", "Woreda", str(woreda.id), {"name": woreda.name})
    db.commit()
    db.refresh(woreda)
    return woreda


@api_router.get("/campaigns")
def list_campaigns(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Campaign).options(joinedload(Campaign.days)).all()


@api_router.post("/campaigns", status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    campaign = Campaign(**payload.model_dump())
    db.add(campaign)
    db.flush()
    log_audit(db, current_user, "CREATE_CAMPAIGN", "Campaign", str(campaign.id), {"code": campaign.code})
    db.commit()
    db.refresh(campaign)
    return campaign


@api_router.post("/reports", status_code=status.HTTP_201_CREATED)
def upsert_draft_report(
    payload: DailyReportPayload,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.WOREDA_OFFICER])),
    db: Session = Depends(get_db),
):
    woreda = db.query(Woreda).filter(Woreda.id == payload.woreda_id).first()
    if not woreda:
        raise HTTPException(status_code=404, detail="Woreda not found.")
    assert_woreda_scope(current_user, woreda.zone_id, woreda.id)

    day = db.query(CampaignDay).filter(CampaignDay.id == payload.campaign_day_id).first()
    if not day:
        raise HTTPException(status_code=404, detail="Campaign day not found.")

    report = (
        db.query(DailyVaccinationReport)
        .filter(
            DailyVaccinationReport.campaign_day_id == payload.campaign_day_id,
            DailyVaccinationReport.woreda_id == payload.woreda_id,
        )
        .first()
    )
    if report and (report.is_locked or report.status not in ("Draft", "Returned for Correction")):
        raise HTTPException(
            status_code=409,
            detail=f"Report is currently '{report.status}' (locked={report.is_locked}) and cannot be edited.",
        )

    target = (
        db.query(AdministrativeTarget)
        .filter(AdministrativeTarget.campaign_id == day.campaign_id, AdministrativeTarget.woreda_id == woreda.id)
        .first()
    )
    total_0_59 = sum(
        ag.vaccinated_before + ag.not_vaccinated_before
        for ag in payload.age_groups
        if ag.age_group in ("0-11m", "12-59m")
    )
    total_60_120 = sum(
        ag.vaccinated_before + ag.not_vaccinated_before
        for ag in payload.age_groups
        if ag.age_group == "60-120m"
    )
    daily_cov = round((total_0_59 / target.daily_target) * 100, 2) if target and target.daily_target else 0.0
    total_cov = round((total_0_59 / target.total_planned_target) * 100, 2) if target and target.total_planned_target else 0.0

    if not report:
        report = DailyVaccinationReport(
            campaign_id=day.campaign_id,
            campaign_day_id=day.id,
            woreda_id=woreda.id,
            status="Draft",
            created_by_id=current_user.id,
        )
        db.add(report)
        db.flush()

    report.total_vaccinated_0_59m = total_0_59
    report.total_vaccinated_60_120m = total_60_120
    report.daily_coverage_pct = daily_cov
    report.cumulative_coverage_pct = total_cov
    report.any_remark = payload.any_remark

    db.query(AgeGroupVaccinationRecord).filter(AgeGroupVaccinationRecord.report_id == report.id).delete()
    for ag in payload.age_groups:
        db.add(AgeGroupVaccinationRecord(report_id=report.id, **ag.model_dump()))

    db.query(VaccineUtilizationRecord).filter(VaccineUtilizationRecord.report_id == report.id).delete()
    for vu in payload.vaccine_utilizations:
        doses_per_vial = 50 if vu.vaccine_type == "nOPV2" else 20
        opened_doses = (vu.vials_used + vu.vials_partially_used) * doses_per_vial
        wastage = round(((opened_doses - total_0_59) / opened_doses) * 100, 2) if opened_doses > 0 else 0.0
        db.add(VaccineUtilizationRecord(report_id=report.id, wastage_rate_pct=max(0.0, wastage), **vu.model_dump()))

    db.query(AfpAefiAlert).filter(AfpAefiAlert.report_id == report.id).delete()
    db.add(AfpAefiAlert(report_id=report.id, afp_alerts_count=payload.afp_alerts_count, aefi_alerts_count=payload.aefi_alerts_count))

    db.query(SocialMobilizationRecord).filter(SocialMobilizationRecord.report_id == report.id).delete()
    db.add(SocialMobilizationRecord(report_id=report.id, hhs_visited=payload.hhs_visited, community_meeting_participants=payload.community_meeting_participants, home_to_home_ipc_reached=payload.home_to_home_ipc_reached))

    db.query(ZeroDoseRecord).filter(ZeroDoseRecord.report_id == report.id).delete()
    db.add(ZeroDoseRecord(report_id=report.id, identified_and_linked=payload.zero_dose_identified, vaccinated=payload.zero_dose_vaccinated))

    db.query(UnderVaccinatedRecord).filter(UnderVaccinatedRecord.report_id == report.id).delete()
    db.add(UnderVaccinatedRecord(report_id=report.id, identified_and_linked=payload.under_vaccinated_identified, vaccinated=payload.under_vaccinated_vaccinated))

    db.query(VaccinationTeam).filter(VaccinationTeam.report_id == report.id).delete()
    db.add(VaccinationTeam(report_id=report.id, total_teams=payload.total_teams, teams_reported=payload.teams_reported))

    db.add(ReportSubmissionHistory(report_id=report.id, from_status=report.status, to_status=report.status, action="SaveDraft", actor_user_id=current_user.id, version=report.version))
    log_audit(db, current_user, "SAVE_DRAFT_REPORT", "DailyVaccinationReport", str(report.id))
    db.commit()
    return {"id": report.id, "status": report.status, "total_vaccinated_0_59m": total_0_59}


def _transition_report(
    db: Session,
    report_id: UUID,
    user: User,
    allowed_from: tuple[str, ...],
    to_status: str,
    action: str,
    comment: Optional[str] = None,
    lock: Optional[bool] = None,
):
    report = db.query(DailyVaccinationReport).options(joinedload(DailyVaccinationReport.woreda)).filter(DailyVaccinationReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    assert_woreda_scope(user, report.woreda.zone_id, report.woreda_id)

    if report.status not in allowed_from:
        raise HTTPException(status_code=409, detail=f"Cannot transition from '{report.status}' to '{to_status}'.")

    prev = report.status
    report.status = to_status
    if lock is not None:
        report.is_locked = lock
    if action == "Submit":
        report.submitted_by_id = user.id
        report.submitted_at = datetime.now(timezone.utc)
    elif action == "StartReview":
        report.reviewed_by_id = user.id
        report.reviewed_at = datetime.now(timezone.utc)
    elif action == "Approve":
        report.approved_by_id = user.id
        report.approved_at = datetime.now(timezone.utc)
    elif action == "Reopen":
        report.version += 1

    db.add(
        ReportSubmissionHistory(
            report_id=report.id,
            from_status=prev,
            to_status=to_status,
            action=action,
            actor_user_id=user.id,
            comment=comment,
            version=report.version,
        )
    )
    db.add(
        Notification(
            recipient_role_code=RoleCode.REGIONAL_COORDINATION if to_status == "Submitted" else RoleCode.WOREDA_OFFICER,
            title=f"Report {to_status}: {report.woreda.name}",
            message=comment or f"Report transitioned from {prev} to {to_status}.",
            severity="warning" if to_status == "Returned for Correction" else "info",
            related_entity_type="DailyVaccinationReport",
            related_entity_id=str(report.id),
        )
    )
    log_audit(db, user, f"REPORT_{action.upper()}", "DailyVaccinationReport", str(report.id), {"from": prev, "to": to_status, "comment": comment})
    db.commit()
    return {"id": report.id, "status": report.status, "is_locked": report.is_locked, "version": report.version}


@api_router.post("/reports/{report_id}/submit")
def submit_report(report_id: UUID, body: WorkflowTransitionRequest, current_user: User = Depends(require_roles([RoleCode.WOREDA_OFFICER, RoleCode.REGIONAL_ADMIN])), db: Session = Depends(get_db)):
    return _transition_report(db, report_id, current_user, ("Draft", "Returned for Correction"), "Submitted", "Submit", body.comment, lock=False)


@api_router.post("/reports/{report_id}/review")
def review_report(report_id: UUID, body: WorkflowTransitionRequest, current_user: User = Depends(require_roles([RoleCode.ZONE_ADMIN, RoleCode.REGIONAL_COORDINATION, RoleCode.REGIONAL_ADMIN])), db: Session = Depends(get_db)):
    return _transition_report(db, report_id, current_user, ("Submitted",), "Under Review", "StartReview", body.comment)


@api_router.post("/reports/{report_id}/approve")
def approve_report(report_id: UUID, body: WorkflowTransitionRequest, current_user: User = Depends(require_roles([RoleCode.ZONE_ADMIN, RoleCode.REGIONAL_COORDINATION, RoleCode.REGIONAL_ADMIN])), db: Session = Depends(get_db)):
    return _transition_report(db, report_id, current_user, ("Submitted", "Under Review"), "Approved", "Approve", body.comment, lock=True)


@api_router.post("/reports/{report_id}/return")
def return_report(report_id: UUID, body: WorkflowTransitionRequest, current_user: User = Depends(require_roles([RoleCode.ZONE_ADMIN, RoleCode.REGIONAL_COORDINATION, RoleCode.REGIONAL_ADMIN])), db: Session = Depends(get_db)):
    if not body.comment:
        raise HTTPException(status_code=400, detail="Correction comment is mandatory when returning a report.")
    return _transition_report(db, report_id, current_user, ("Submitted", "Under Review"), "Returned for Correction", "ReturnForCorrection", body.comment, lock=False)


@api_router.post("/reports/{report_id}/reopen")
def reopen_report(report_id: UUID, body: WorkflowTransitionRequest, current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN])), db: Session = Depends(get_db)):
    if not body.comment:
        raise HTTPException(status_code=400, detail="Administrative justification is mandatory when reopening a locked report.")
    return _transition_report(db, report_id, current_user, ("Approved",), "Returned for Correction", "Reopen", body.comment, lock=False)


@api_router.get("/workbook-audit/discrepancies")
def list_discrepancies(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(FormulaDiscrepancy).order_by(FormulaDiscrepancy.severity, FormulaDiscrepancy.created_at).all()


@api_router.post("/workbook-audit/discrepancies/{discrepancy_id}/resolve")
def resolve_discrepancy(
    discrepancy_id: UUID,
    body: DiscrepancyResolutionRequest,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    disc = db.query(FormulaDiscrepancy).filter(FormulaDiscrepancy.id == discrepancy_id).first()
    if not disc:
        raise HTTPException(status_code=404, detail="Discrepancy record not found.")
    disc.ohb_approval_status = body.ohb_approval_status
    disc.resolution_notes = body.resolution_notes
    disc.approved_by_id = current_user.id
    log_audit(db, current_user, "RESOLVE_FORMULA_DISCREPANCY", "FormulaDiscrepancy", str(disc.id), body.model_dump())
    db.commit()
    return disc


@api_router.get("/audit-logs")
def list_audit_logs(current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION, RoleCode.MONITORING_OFFICER])), db: Session = Depends(get_db)):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()
