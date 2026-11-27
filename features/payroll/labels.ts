import type { DeductionCategory, EarningCategory, PayItemSchedule, PayTypeAppliesTo } from "@/lib/types";

// Legal treatments a company type can fall under. The company picks one; the law decides what it means.
export const earningLabel: Record<EarningCategory, string> = {
  taxable_allowance: "Allowance (taxable)",
  de_minimis: "De minimis benefit",
  other_benefit: "Bonus or other benefit",
  commission: "Commission",
  reimbursement: "Reimbursement",
  adjustment: "Pay adjustment",
};
export const deductionLabel: Record<DeductionCategory, string> = {
  sss_loan: "SSS loan",
  pagibig_loan: "Pag-IBIG loan",
  company_loan: "Company loan or cash advance",
  union_dues: "Union dues",
  insurance: "Insurance premium",
  loss_damage: "Loss or damage",
  other_authorized: "Other authorized deduction",
};
export const scheduleLabel: Record<PayItemSchedule, string> = {
  every_cutoff: "Every cutoff", first_cutoff: "1st–15th cutoff only", second_cutoff: "16th–end cutoff only", once: "Once",
};

export const appliesToLabel: Record<PayTypeAppliesTo, string> = {
  individual: "Person by person", all: "Everyone", rank_and_file: "All rank-and-file staff", managerial: "All managerial staff",
};

export const treatmentHint: Record<string, string> = {
  taxable_allowance: "Taxable, and counted for SSS. For allowances that aren’t liquidated: transport, communication, meals.",
  de_minimis: "Tax-free up to the RR 29-2025 ceiling for the benefit you pick; anything over counts toward the ₱90,000 yearly limit.",
  other_benefit: "Bonuses, incentives and gifts. Tax-free up to ₱90,000 a year together with 13th month pay; taxed after that.",
  commission: "Taxable, and counted for SSS.",
  reimbursement: "Only for expenses backed by receipts. Not pay, so not taxed and not counted for SSS.",
  adjustment: "Pay owed from an earlier period. Taxable.",
  sss_loan: "Allowed by law. No separate consent needed.",
  pagibig_loan: "Allowed by law. No separate consent needed.",
  company_loan: "Needs each employee’s signed authorization: purpose, amount, number of deductions (DO 195-18).",
  union_dues: "Needs a check-off authorization. Excluded from taxable pay.",
  insurance: "Premiums the company advanced, with each employee’s written consent.",
  loss_damage: "Only after the employee was heard and responsibility is shown. Capped at 20% of wages (Art. 114–115).",
  other_authorized: "Needs each employee’s signed authorization, and the company can’t benefit from it (Art. 113).",
};
