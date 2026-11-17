import csv
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List


@dataclass
class WorkbookRow:
    sn: int
    region: str
    zone: str
    raw_zone: str
    woreda: str
    raw_woreda: str
    campaign_day_label: str
    total_planned_target: int
    daily_target: int
    is_duplicate_pair: bool


@dataclass
class DiscrepancyItem:
    worksheet: str
    cell_or_column: str
    severity: str
    title: str
    observed_value: str
    expected_value: str
    recommendation: str


def parse_int(val: str) -> int:
    cleaned = (val or "").replace(",", "").strip()
    return int(cleaned) if cleaned else 0


def inspect_day1_csv(csv_path: str) -> Dict:
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    data_rows = [r for r in rows[4:265] if len(r) >= 7 and r[0].strip().isdigit()]
    totals_row = rows[265] if len(rows) > 265 else []

    pair_counts = Counter((r[2].strip(), r[3].strip()) for r in data_rows)
    parsed_rows: List[WorkbookRow] = []

    sum_planned = 0
    sum_daily = 0
    whitespace_examples = []

    for r in data_rows:
        sn = int(r[0].strip())
        raw_reg, raw_zone, raw_woreda = r[1], r[2], r[3]
        zone = raw_zone.strip()
        woreda = raw_woreda.strip()
        planned = parse_int(r[5])
        daily = parse_int(r[6])
        sum_planned += planned
        sum_daily += daily

        if raw_reg != raw_reg.strip() or raw_zone != zone or raw_woreda != woreda:
            whitespace_examples.append(f"S/N {sn}: ({raw_zone!r}, {raw_woreda!r})")

        parsed_rows.append(
            WorkbookRow(
                sn=sn,
                region=raw_reg.strip(),
                zone=zone,
                raw_zone=raw_zone,
                woreda=woreda,
                raw_woreda=raw_woreda,
                campaign_day_label=r[4].strip(),
                total_planned_target=planned,
                daily_target=daily,
                is_duplicate_pair=pair_counts[(zone, woreda)] > 1,
            )
        )

    totals_planned = parse_int(totals_row[5]) if len(totals_row) > 5 else 0
    totals_daily = parse_int(totals_row[6]) if len(totals_row) > 6 else 0

    discrepancies: List[DiscrepancyItem] = [
        DiscrepancyItem(
            worksheet="Day1",
            cell_or_column="Row 266 / Col F (Total Planned Target)",
            severity="Critical",
            title="Regional Total Planned Target Formula Truncation",
            observed_value=f"{totals_planned:,}",
            expected_value=f"{sum_planned:,}",
            recommendation="Correct the Excel SUM range for Row 266 Col F to cover all 261 Woredas (Rows 5-265) and lock formula cells in OPCMS.",
        ),
        DiscrepancyItem(
            worksheet="Day1",
            cell_or_column="Row 266 / Col G (Daily Target)",
            severity="Medium",
            title="Daily Target Rounding Drift Between Row Sum and Regional Division",
            observed_value=f"{totals_daily:,} (round({sum_planned:,}/4))",
            expected_value=f"{sum_daily:,} (sum of Woreda daily targets)",
            recommendation="Approve whether regional daily target equals sum of rounded Woreda daily targets (1,895,263) or round(regional_total/4) (1,895,229).",
        ),
        DiscrepancyItem(
            worksheet="Day1 - Day6",
            cell_or_column="Col E & Col G (Campaign Date / Daily Target)",
            severity="High",
            title="4-Day Target Divisor vs. 6 Daily Worksheets",
            observed_value="Header states '1st,2nd,3rd, 4th'; Daily Target = round(Planned/4)",
            expected_value="Workbook specifies Day1..Day6 (6 daily sheets)",
            recommendation="Confirm with OHB that Days 1-4 carry 25% daily targets and Days 5-6 operate as Mop-Up / Catch-Up with remaining unreached targets.",
        ),
        DiscrepancyItem(
            worksheet="Day1",
            cell_or_column="Cols L-N (60-120m vs Total vaccinated 0-59m)",
            severity="High",
            title="60-120m Cohort Excluded from Total Vaccinated 0-59m & Coverage %",
            observed_value="60-120m columns exist alongside 0-11m and 12-59m, while Col N sums 0-59m only",
            expected_value="Explicitly separate 0-59m primary SIA coverage from 60-120m catch-up/special cohort",
            recommendation="Retain Col N strictly as 0-59m to match Total Planned Target (0-59m), and display 60-120m as a dedicated co-tracked cohort pending OHB sign-off.",
        ),
        DiscrepancyItem(
            worksheet="Day1",
            cell_or_column="Cols C-D (Zone / Woreda)",
            severity="High",
            title="Duplicate (Zone, Woreda) Pairs with Distinct Target Allocations",
            observed_value="Jimma Town (121,871 & 43,934); Asella (88,943 & 39,690); Modjo Town/Modjo (29,903 & 38,384)",
            expected_value="Unique reporting unit identifier per Woreda/Sub-city",
            recommendation="Preserve distinct reporting_unit_code (e.g. JIMMA-TOWN-01 / JIMMA-TOWN-02) until OHB clarifies sub-city vs rural/urban split.",
        ),
        DiscrepancyItem(
            worksheet="Day1",
            cell_or_column="Cols B-D, P, Q, Y (Naming & Headers)",
            severity="Low",
            title="Trailing Whitespace, Inconsistent Casing & Header Typos",
            observed_value=f"{', '.join(whitespace_examples)}; 'AmboTown', 'North shoa', 'south West Shewa', 'recieved', 'Coverd'",
            expected_value="Standardized Oromia administrative names and clean labels",
            recommendation="Normalize whitespace and display labels in OPCMS while retaining raw_excel_name for backward compatibility with Excel imports.",
        ),
    ]

    return {
        "rows": parsed_rows,
        "summary": {
            "row_count": len(parsed_rows),
            "unique_zones": len(set(r.zone for r in parsed_rows)),
            "computed_planned_total": sum_planned,
            "template_reported_planned_total": totals_planned,
            "computed_daily_total": sum_daily,
            "template_reported_daily_total": totals_daily,
        },
        "discrepancies": discrepancies,
    }
