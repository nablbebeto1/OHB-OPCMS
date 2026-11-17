from datetime import datetime, timezone
from io import BytesIO
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl import load_workbook
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import RoleCode, get_current_user, require_roles
from app.db.session import get_db
from app.models import (
    AuditLog,
    CalculationConfig,
    Campaign,
    DailyVaccinationReport,
    ExcelImportHistory,
    SecurityAffectedSettlement,
    SecurityDailyReport,
    User,
    Woreda,
)

ext_router = APIRouter()


class CalculationConfigInput(BaseModel):
    campaign_id: UUID
    version: str
    name: str
    daily_target_divisor: int = 4
    nopv2_doses_per_vial_default: int = 50
    bopv_doses_per_vial_default: int = 20
    wastage_denominator_mode: str = "used_plus_partial"
    total_vaccinated_scope: str = "0-59m_only"
    documented_definition: str


@ext_router.get("/calculation-configs")
def list_calculation_configs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(CalculationConfig).order_by(CalculationConfig.created_at.desc()).all()


@ext_router.post("/calculation-configs", status_code=201)
def create_calculation_config(
    payload: CalculationConfigInput,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN])),
    db: Session = Depends(get_db),
):
    cfg = CalculationConfig(
        **payload.model_dump(),
        approval_status="Pending Approval",
        is_active=False,
        created_by_id=current_user.id,
    )
    db.add(cfg)
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            actor_username=current_user.username,
            actor_role=current_user.role.code,
            action="CREATE_CALCULATION_CONFIG",
            entity_type="CalculationConfig",
            entity_id=str(cfg.id),
            details={"version": cfg.version, "name": cfg.name},
        )
    )
    db.commit()
    db.refresh(cfg)
    return cfg


@ext_router.post("/calculation-configs/{config_id}/approve")
def approve_calculation_config(
    config_id: UUID,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    cfg = db.query(CalculationConfig).filter(CalculationConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Calculation config not found.")
    db.query(CalculationConfig).filter(CalculationConfig.campaign_id == cfg.campaign_id).update({"is_active": False})
    cfg.approval_status = "Approved"
    cfg.is_active = True
    cfg.approved_by_id = current_user.id
    cfg.approved_at = datetime.now(timezone.utc)
    db.commit()
    return cfg


@ext_router.post("/imports/xlsx-preview")
async def preview_xlsx_import(
    file: UploadFile = File(...),
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    content = await file.read()
    wb = load_workbook(filename=BytesIO(content), data_only=False)
    expected_sheets = ["Day1", "Day2", "Day3", "Day4", "Day5", "Day6", "Summary", "Security Affected Areas"]
    sheet_summary = []
    for name in wb.sheetnames:
        ws = wb[name]
        sheet_summary.append({"sheet_name": name, "rows": ws.max_row, "cols": ws.max_column})

    return {
        "filename": file.filename,
        "sheets_found": wb.sheetnames,
        "missing_expected_sheets": [s for s in expected_sheets if s not in wb.sheetnames],
        "sheet_summary": sheet_summary,
    }


@ext_router.get("/imports/history")
def list_import_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(ExcelImportHistory).order_by(ExcelImportHistory.created_at.desc()).all()


@ext_router.get("/security-settlements")
def list_security_settlements(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(SecurityAffectedSettlement).all()


@ext_router.get("/security-reports")
def list_security_reports(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(SecurityDailyReport).all()
