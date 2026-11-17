import type {
  AgeGroupInput,
  CalculationConfigRecord,
  VaccineUtilizationInput,
} from '../types/opcms';

export function formatPctOrNA(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }
  return `${value.toFixed(1)}%`;
}

export function safePercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function computeVaccinationTotals(
  ageGroups: AgeGroupInput[],
  scope: '0-59m_only' | '0-120m_all' = '0-59m_only',
) {
  const sum011 = ageGroups
    .filter((a) => a.age_group === '0-11m')
    .reduce((s, a) => s + (a.vaccinated_before || 0) + (a.not_vaccinated_before || 0), 0);
  const sum1259 = ageGroups
    .filter((a) => a.age_group === '12-59m')
    .reduce((s, a) => s + (a.vaccinated_before || 0) + (a.not_vaccinated_before || 0), 0);
  const sum60120 = ageGroups
    .filter((a) => a.age_group === '60-120m')
    .reduce((s, a) => s + (a.vaccinated_before || 0) + (a.not_vaccinated_before || 0), 0);

  const total059 = sum011 + sum1259;
  const effectiveTotal = scope === '0-120m_all' ? total059 + sum60120 : total059;
  return {sum011, sum1259, sum60120, total059, effectiveTotal};
}

export function computeWastageRatePct(
  vu: VaccineUtilizationInput,
  dosesAdministered: number,
  dosesPerVial: number,
  mode: CalculationConfigRecord['wastage_denominator_mode'] = 'used_plus_partial',
): number | null {
  let denominatorVials = 0;
  if (mode === 'used_only') {
    denominatorVials = vu.vials_used;
  } else if (mode === 'received_minus_returned_good') {
    denominatorVials = Math.max(0, vu.vials_received - vu.vials_returned_unused_good);
  } else {
    denominatorVials = vu.vials_used + vu.vials_partially_used;
  }

  const denominatorDoses = denominatorVials * dosesPerVial;
  if (denominatorDoses <= 0) {
    return null;
  }
  const rate = ((denominatorDoses - dosesAdministered) / denominatorDoses) * 100;
  return Number(rate.toFixed(2));
}

export interface ReportValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateDailyReportData(params: {
  ageGroups: AgeGroupInput[];
  vaccines: VaccineUtilizationInput[];
  afpAlerts: number;
  aefiAlerts: number;
  hhsVisited: number;
  communityMeetings: number;
  ipcReached: number;
  zeroDoseIdentified: number;
  zeroDoseLinked: number;
  zeroDoseVaccinated: number;
  underVaxIdentified: number;
  underVaxLinked: number;
  underVaxVaccinated: number;
  totalTeams: number;
  teamsReported: number;
  nopv2DosesPerVial: number;
  bopvDosesPerVial: number;
  wastageMode: CalculationConfigRecord['wastage_denominator_mode'];
}): ReportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Negative value check
  for (const ag of params.ageGroups) {
    if (ag.vaccinated_before < 0 || ag.not_vaccinated_before < 0) {
      errors.push(`Negative vaccination count detected in age group ${ag.age_group}.`);
    }
  }
  for (const v of params.vaccines) {
    const vals = [
      v.vials_received,
      v.vials_used,
      v.vials_partially_used,
      v.vials_returned_unused_good,
      v.vials_broken,
      v.vials_returned_bad_stage_3_4,
      v.vials_lost,
    ];
    if (vals.some((n) => n < 0)) {
      errors.push(`Negative vial count detected in ${v.vaccine_type} utilization.`);
    }
  }
  if (
    params.afpAlerts < 0 ||
    params.aefiAlerts < 0 ||
    params.hhsVisited < 0 ||
    params.communityMeetings < 0 ||
    params.ipcReached < 0 ||
    params.zeroDoseIdentified < 0 ||
    params.zeroDoseLinked < 0 ||
    params.zeroDoseVaccinated < 0 ||
    params.underVaxIdentified < 0 ||
    params.underVaxLinked < 0 ||
    params.underVaxVaccinated < 0 ||
    params.totalTeams < 0 ||
    params.teamsReported < 0
  ) {
    errors.push('Negative counts are prohibited across surveillance, mobilization, and team fields.');
  }

  // 2. Impossible totals check
  if (params.teamsReported > params.totalTeams && params.totalTeams > 0) {
    errors.push(
      `Teams reported (${params.teamsReported}) exceeds total vaccination teams (${params.totalTeams}).`,
    );
  }
  if (params.zeroDoseLinked > params.zeroDoseIdentified) {
    errors.push(
      `Zero-dose linked (${params.zeroDoseLinked}) cannot exceed identified (${params.zeroDoseIdentified}).`,
    );
  }
  if (params.zeroDoseVaccinated > params.zeroDoseIdentified) {
    errors.push(
      `Zero-dose vaccinated (${params.zeroDoseVaccinated}) cannot exceed identified (${params.zeroDoseIdentified}).`,
    );
  }
  if (params.underVaxLinked > params.underVaxIdentified) {
    errors.push(
      `Under-vaccinated linked (${params.underVaxLinked}) cannot exceed identified (${params.underVaxIdentified}).`,
    );
  }
  if (params.underVaxVaccinated > params.underVaxIdentified) {
    errors.push(
      `Under-vaccinated vaccinated (${params.underVaxVaccinated}) cannot exceed identified (${params.underVaxIdentified}).`,
    );
  }

  // 3. Vaccine reconciliation & wastage sanity check
  const {total059} = computeVaccinationTotals(params.ageGroups, '0-59m_only');
  for (const v of params.vaccines) {
    const accounted =
      v.vials_used +
      v.vials_partially_used +
      v.vials_returned_unused_good +
      v.vials_broken +
      v.vials_returned_bad_stage_3_4 +
      v.vials_lost;
    if (v.vials_received > 0 && accounted !== v.vials_received) {
      warnings.push(
        `${v.vaccine_type} vial reconciliation mismatch: received ${v.vials_received} vials, accounted ${accounted} vials (delta ${accounted - v.vials_received}).`,
      );
    }
    const dpv = v.vaccine_type === 'nOPV2' ? params.nopv2DosesPerVial : params.bopvDosesPerVial;
    const wastage = computeWastageRatePct(v, total059, dpv, params.wastageMode);
    if (wastage !== null && wastage < 0) {
      warnings.push(
        `${v.vaccine_type} wastage rate is negative (${wastage}%): 0-59m doses (${total059}) exceed theoretical doses in opened vials.`,
      );
    }
  }

  if (params.afpAlerts > 0 || params.aefiAlerts > 0) {
    warnings.push(
      `Surveillance alert reported (${params.afpAlerts} AFP, ${params.aefiAlerts} AEFI) — will escalate to Regional Coordination Team on submission.`,
    );
  }

  return {errors, warnings};
}
