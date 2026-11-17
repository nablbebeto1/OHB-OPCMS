# Oromia Region 2026 Round 1 nOPV2 & bOPV SIA Workbook Inspection & Formula Audit

**Source File Inspected:** `Oromia Region – Round 1 nOPV2 and bOPV2 SIA Campaign Daily Administrative Report – November 2026.csv`  
**Expected Workbook Structure:** `Day1`, `Day2`, `Day3`, `Day4`, `Day5`, `Day6`, `Summary`, `Security Affected Areas`

---

## 1. Inspected CSV Structure (`Day1` Worksheet)

- **Title Row (Row 1):** `2026_Round 1  nOPV2 and bOPV Co-administration campaign Daily Admin Data Entry and Reporting Template  (Day1)`
- **Total Columns:** 44 columns across 3 header rows (Rows 2–4).
- **Data Rows:** 261 Woreda reporting rows (`S/N 1` through `S/N 261`) across **28 Zones / Towns / Cities** in **Oromia Region**.
- **Totals Row:** Row 266 (`Oromia Region Totals`), followed by blank template rows up to Row 1000.

### Column Groups (Exact Mapping, No Invented Indicators)
1. **Administrative Identification (Cols 1–5):** `S/N`, `Region`, `Zone`, `Woreda`, `Campaign Date (1st,2nd,3rd, 4th)`
2. **Target vs Coverage (Cols 6–16):**
   - `Total Planned Target (n)`
   - `Daily Target (n)`
   - `0-11 m (n)` → `Vaccinated before`, `Not vaccinated before`
   - `12-59 m (n)` → `Vaccinated before`, `Not vaccinated before`
   - `60-120 m (n)` → `Vaccinated before`, `Not vaccinated before`
   - `Total vaccinated 0-59 m (n)`
   - `Daily Covered (%)`
   - `Coverd from total(%)`
3. **nOPV2 Vaccine Utilization (Cols 17–24):** `# recieved`, `# used`, `# partially used`, `# returned unused with good condition`, `# broken`, `# returned with bad condition (Stage 3 & 4)`, `# lost`, `Vaccine wastage rate (%)`
4. **bOPV Vaccine Utilization (Cols 25–32):** Same 8 vial-tracking indicators for `bOPV`
5. **Surveillance Alerts (Cols 33–34):** `# of AFP alerts`, `# of AEFI alerts`
6. **Social Mobilization (Cols 35–37):** `# of HHs visited by social mobilizers`, `# of parents or caregivers participated on group discussion (Community Meetings)`, `# of parents or caregivers reached with home to Home Education /interpersonal communication/`
7. **Zero Dose Integration (Cols 38–39):** `# of zero dose identified and linked`, `# of zero dose vaccinated`
8. **Under-vaccinated Children (Cols 40–41):** `# of under vaccinated children identified and linked`, `# of under vaccinated children vaccinated`
9. **Vaccination Team (Cols 42–43):** `# of Vaccination Team`, `# of Vaccination Team Reported`
10. **Remarks (Col 44):** `Any Remark`

---

## 2. Formula & Data Inconsistencies Identified for OHB Approval

| ID | Severity | Worksheet / Location | Observed in Workbook | Expected / Verified Value | Recommended Action for OHB Approval |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DISC-01** | **Critical** | `Day1`, Row 266, Col F (`Total Planned Target (n)`) | **`33,537`** | **`7,580,915`** (exact sum of S/N 1–261) | The regional totals cell appears truncated or overwritten (`-7,547,378` variance). OPCMS computes regional totals dynamically from Woreda targets; confirm `7,580,915` as official regional denominator. |
| **DISC-02** | **Medium** | `Day1`, Row 266, Col G (`Daily Target (n)`) | **`1,895,229`** (`round(7,580,915 / 4)`) | **`1,895,263`** (sum of rounded Woreda Daily Targets) | `+34` rounding drift between summing Woreda rounded rows vs. dividing regional total by 4. Approve bottom-up sum (`1,895,263`) or top-down division. |
| **DISC-03** | **High** | `Day1`–`Day6`, Col E & Col G | Header says `(1st,2nd,3rd, 4th)` and `Daily Target = round(Planned / 4)` | Workbook contains 6 daily sheets (`Day1`–`Day6`) | Confirm that Days 1–4 carry 25% daily targets and Days 5–6 represent Mop-Up / Catch-Up days against unreached residual targets. |
| **DISC-04** | **High** | `Day1`, Cols L–P (`60-120 m` vs `Total vaccinated 0-59 m`) | `60-120 m` columns appear inside Target vs Coverage, while Col N is `Total vaccinated 0-59 m (n)` | Coverage % denominator is `0-59 m` | Confirm keeping `Total vaccinated 0-59 m (n)` strictly for `0-11m + 12-59m`, and tracking `60-120m` separately without inflating `0-59m` coverage %. |
| **DISC-05** | **High** | `Day1`, Cols C–D (`Zone`, `Woreda`) | 3 duplicate `(Zone, Woreda)` pairs with different targets: `Jimma Town` (`121,871` & `43,934`), `Asella` (`88,943` & `39,690`), `Modjo Town/Modjo` (`29,903` & `38,384`) | Unique reporting unit identifiers | Assign distinct reporting unit codes (`JIMMA-TOWN-01`, `JIMMA-TOWN-02`, etc.) until OHB confirms sub-city/urban-rural split. |
| **DISC-06** | **Medium** | `Day1`, Cols X & AF (`Vaccine wastage rate (%)`) | Blank template shows `0%`; vial dose factors (50 doses/vial nOPV2 vs 20 doses/vial bOPV) and partial vial handling not explicit | Standardized WHO/EPI wastage formula | Approve wastage formula: `((Vials Used × Doses/Vial) - Doses Administered) / (Vials Used × Doses/Vial) × 100`, clarifying whether partially used vials are included in `Vials Used`. |
| **DISC-07** | **Low** | `Day1`, Cols B–D & Headers | Trailing spaces (`'Oromia '`, `'Dodola Town '`, `'Adama City '`), casing (`'AmboTown'`, `'North shoa'`, `'south West Shewa'`, `'sasiga'`), typos (`recieved`, `Coverd`) | Standardized administrative naming | Normalize display labels in OPCMS while preserving `raw_excel_name` for Excel import matching. |
| **DISC-08** | **Info** | Multi-Sheet Scope | Uploaded file is CSV export of `Day1` only | 8 sheets (`Day1`–`Day6`, `Summary`, `Security Affected Areas`) | Schema and API support all 8 worksheets; upload `.xlsx` multi-sheet workbook in Phase 2 to populate `Security Affected Areas` and `Day2`–`Day6`. |
