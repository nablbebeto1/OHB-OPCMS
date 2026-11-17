"""Seed PostgreSQL database from the official OHB Day 1 CSV template."""
from datetime import date, timedelta
import os
import sys

from sqlalchemy.orm import Session

from app.core.security import RoleCode, hash_password
from app.db.session import SessionLocal
from app.models import (
    AdministrativeTarget,
    AuditLog,
    Campaign,
    CampaignDay,
    ExcelImportHistory,
    FormulaDiscrepancy,
    Permission,
    Region,
    Role,
    RolePermission,
    User,
    Woreda,
    Zone,
)
from app.services.workbook_inspector import inspect_day1_csv

ZONE_COORDS = {
    "Adama City": (8.5400, 39.2700, "City"),
    "Agaro Town": (7.8500, 36.6500, "Town"),
    "AmboTown": (8.9833, 37.8500, "Town"),
    "Arsi Zone": (7.9500, 39.1333, "Zone"),
    "Asella": (7.9500, 39.1333, "Town"),
    "Batu Town": (7.9333, 38.7167, "Town"),
    "Bishoftu City": (8.7500, 38.9833, "City"),
    "Buno Bedele": (8.4500, 36.3500, "Zone"),
    "Dodola Town": (6.9833, 39.1833, "Town"),
    "East Shewa": (8.5500, 39.2500, "Zone"),
    "East Wollega": (9.0833, 36.5500, "Zone"),
    "Guji": (5.8833, 38.9833, "Zone"),
    "Holeta town": (9.0667, 38.5000, "Town"),
    "Horro Guduru Wallaga": (9.5667, 37.1000, "Zone"),
    "Jimma Town": (7.6667, 36.8333, "Town"),
    "Jimma Zone": (7.6800, 36.8400, "Zone"),
    "Modjo Town": (8.5833, 39.1167, "Town"),
    "Nekemte Town": (9.0833, 36.5500, "Town"),
    "North shoa": (9.8000, 38.7333, "Zone"),
    "Sendafa Beke Town": (9.1500, 39.0333, "Town"),
    "Shaggar City": (9.0100, 38.6800, "City"),
    "Shakiso Town": (5.7667, 38.9167, "Town"),
    "Shashemene City": (7.2000, 38.6000, "City"),
    "Sheno Town": (9.3333, 39.3000, "Town"),
    "West Arsi": (7.1833, 38.6167, "Zone"),
    "West Shewa": (8.9800, 37.8600, "Zone"),
    "Woliso Town": (8.5333, 37.9667, "Town"),
    "south West Shewa": (8.5300, 37.9800, "Zone"),
}


def seed(csv_path: str) -> None:
    db: Session = SessionLocal()
    try:
        if db.query(Region).filter(Region.code == "OR").first():
            print("Database already seeded. Skipping.")
            return

        region = Region(code="OR", name="Oromia")
        db.add(region)
        db.flush()

        inspection = inspect_day1_csv(csv_path)
        zones_by_name = {}
        unit_counter = {}

        for row in inspection["rows"]:
            norm_zone = row.zone.lower()
            if norm_zone not in zones_by_name:
                lat, lng, ztype = ZONE_COORDS.get(row.zone, (8.5, 38.8, "Zone"))
                code = row.zone.upper().replace(" ", "_")
                zone = Zone(
                    region_id=region.id,
                    code=code,
                    name=row.zone,
                    normalized_name=norm_zone,
                    zone_type=ztype,
                    latitude=lat,
                    longitude=lng,
                )
                db.add(zone)
                db.flush()
                zones_by_name[norm_zone] = zone

            zone = zones_by_name[norm_zone]
            key = (zone.code, row.woreda.upper().replace(" ", "_"))
            unit_counter[key] = unit_counter.get(key, 0) + 1
            unit_code = f"{zone.code}-{row.woreda.upper().replace(' ', '_')}-{unit_counter[key]:02d}"

            woreda = Woreda(
                zone_id=zone.id,
                reporting_unit_code=unit_code,
                source_sn=row.sn,
                name=row.woreda,
                raw_excel_name=row.raw_woreda,
                is_duplicate_in_template=row.is_duplicate_pair,
                latitude=zone.latitude,
                longitude=zone.longitude,
            )
            db.add(woreda)
            db.flush()
            row._woreda_id = woreda.id

        roles_data = [
            (RoleCode.REGIONAL_ADMIN, "Regional System Administrator", False, "Full system administration, user/role management, hierarchy control, campaign setup, and reopening locked reports."),
            (RoleCode.REGIONAL_COORDINATION, "Regional Coordination Team", False, "Regional campaign monitoring, report verification, approval/return workflow, and workbook audit sign-off."),
            (RoleCode.ZONE_ADMIN, "Zone Administrator", False, "Zone-scoped oversight, woreda report review/approval/return within assigned zone."),
            (RoleCode.WOREDA_OFFICER, "Woreda Reporting Officer", False, "Woreda-scoped daily data entry, draft saving, submission, and correction of returned reports."),
            (RoleCode.MONITORING_OFFICER, "Monitoring Officer", True, "Strictly read-only monitoring access across assigned regional or zonal scope."),
        ]
        roles = {}
        for code, name, ro, desc in roles_data:
            role = Role(code=code, name=name, is_read_only=ro, description=desc)
            db.add(role)
            db.flush()
            roles[code] = role

        perm_defs = [
            ("hierarchy:read", "hierarchy"), ("hierarchy:write", "hierarchy"),
            ("campaign:read", "campaign"), ("campaign:write", "campaign"),
            ("report:read", "reporting"), ("report:write", "reporting"),
            ("report:submit", "reporting"), ("report:review", "reporting"),
            ("report:approve", "reporting"), ("report:reopen", "reporting"),
            ("audit:read", "governance"), ("users:manage", "auth"),
        ]
        perms = {}
        for pcode, mod in perm_defs:
            p = Permission(code=pcode, module=mod)
            db.add(p)
            db.flush()
            perms[pcode] = p

        role_perm_map = {
            RoleCode.REGIONAL_ADMIN: list(perms.keys()),
            RoleCode.REGIONAL_COORDINATION: ["hierarchy:read", "campaign:read", "campaign:write", "report:read", "report:review", "report:approve", "audit:read"],
            RoleCode.ZONE_ADMIN: ["hierarchy:read", "campaign:read", "report:read", "report:review", "report:approve"],
            RoleCode.WOREDA_OFFICER: ["hierarchy:read", "campaign:read", "report:read", "report:write", "report:submit"],
            RoleCode.MONITORING_OFFICER: ["hierarchy:read", "campaign:read", "report:read", "audit:read"],
        }
        for rcode, pcodes in role_perm_map.items():
            for pcode in pcodes:
                db.add(RolePermission(role_id=roles[rcode].id, permission_id=perms[pcode].id))

        east_shewa = zones_by_name.get("east shewa")
        adama = db.query(Woreda).filter(Woreda.name == "Adama").first()

        demo_users = [
            ("admin.ohb", "admin@ohb.gov.et", "Dr. Bekele Tadesse", RoleCode.REGIONAL_ADMIN, None, None),
            ("coord.ohb", "coordination@ohb.gov.et", "Chaltu Gemechu", RoleCode.REGIONAL_COORDINATION, None, None),
            ("zone.eastshewa", "eastshewa@ohb.gov.et", "Tolera Merga", RoleCode.ZONE_ADMIN, east_shewa.id if east_shewa else None, None),
            ("woreda.adama", "adama.officer@ohb.gov.et", "Bontu Alemu", RoleCode.WOREDA_OFFICER, east_shewa.id if east_shewa else None, adama.id if adama else None),
            ("monitor.ohb", "monitor@ohb.gov.et", "Dawit Negash", RoleCode.MONITORING_OFFICER, None, None),
        ]
        admin_user = None
        for uname, email, fname, rcode, zid, wid in demo_users:
            u = User(
                username=uname,
                email=email,
                full_name=fname,
                password_hash=hash_password("OhbPolio@2026"),
                role_id=roles[rcode].id,
                region_id=region.id,
                zone_id=zid,
                woreda_id=wid,
            )
            db.add(u)
            db.flush()
            if rcode == RoleCode.REGIONAL_ADMIN:
                admin_user = u

        start = date(2026, 11, 20)
        campaign = Campaign(
            code="OR-2026-R1-NOPV2-BOPV",
            name="2026 Round 1 nOPV2 and bOPV Co-administration Campaign",
            round_number=1,
            vaccine_types="nOPV2 + bOPV Co-administration",
            nopv2_doses_per_vial=50,
            bopv_doses_per_vial=20,
            core_target_days_divisor=4,
            total_campaign_days=6,
            start_date=start,
            end_date=start + timedelta(days=5),
            status="Active",
            region_id=region.id,
        )
        db.add(campaign)
        db.flush()

        for d in range(1, 7):
            db.add(
                CampaignDay(
                    campaign_id=campaign.id,
                    day_number=d,
                    label=f"Day {d}",
                    worksheet_name=f"Day{d}",
                    day_type="Core" if d <= 4 else "Mop-Up",
                    campaign_date=start + timedelta(days=d - 1),
                    is_open_for_reporting=(d == 1),
                )
            )

        for row in inspection["rows"]:
            db.add(
                AdministrativeTarget(
                    campaign_id=campaign.id,
                    woreda_id=row._woreda_id,
                    total_planned_target=row.total_planned_target,
                    daily_target=row.daily_target,
                    source_reference=f"Day1 S/N {row.sn}",
                )
            )

        imp = ExcelImportHistory(
            filename="Oromia Region – Round 1 nOPV2 and bOPV2 SIA Campaign Daily Administrative Report – November 2026.csv",
            worksheet_names=["Day1", "Day2", "Day3", "Day4", "Day5", "Day6", "Summary", "Security Affected Areas"],
            rows_processed=inspection["summary"]["row_count"],
            discrepancies_detected=len(inspection["discrepancies"]),
            imported_by_id=admin_user.id if admin_user else None,
            status="Audited",
            notes="Initial baseline import of Day1 worksheet structure and targets.",
        )
        db.add(imp)
        db.flush()

        for disc in inspection["discrepancies"]:
            db.add(
                FormulaDiscrepancy(
                    import_id=imp.id,
                    worksheet=disc.worksheet,
                    cell_or_column=disc.cell_or_column,
                    severity=disc.severity,
                    title=disc.title,
                    observed_value=disc.observed_value,
                    expected_value=disc.expected_value,
                    recommendation=disc.recommendation,
                )
            )

        db.add(
            AuditLog(
                actor_user_id=admin_user.id if admin_user else None,
                actor_username="admin.ohb",
                actor_role=RoleCode.REGIONAL_ADMIN,
                action="SEED_CAMPAIGN_BASELINE",
                entity_type="Campaign",
                entity_id=str(campaign.id),
                details=inspection["summary"],
            )
        )
        db.commit()
        print("OPCMS database seeded successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    default_csv = os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..", "public", "assets", "aistudio",
        "Oromia_Region___Round_1_nOPV2_and_bOPV2_SIA_Campaign_Daily_Administrative_Report___November_2026__1__47c4f776.csv",
    )
    csv_arg = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(default_csv)
    seed(csv_arg)
