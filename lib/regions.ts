// Regional daily minimum wages, non-agriculture, largest establishment category, as of November 27, 2026.
// Source: laborcode.ph summary of the wage orders (https://laborcode.ph/minimum-wage-philippines/).
// Verify the exact figure for the locality, sector and establishment size against the wage order itself.
// Update this table whenever a Regional Tripartite Wages and Productivity Board issues a new order.

import type { PhRegion } from "./types";

export interface RegionalWage {
  region: PhRegion;
  name: string;
  daily: number;
  wageOrder: string;
  effective: string;
  note?: string;
}

export const REGIONAL_WAGES: RegionalWage[] = [
  { region: "NCR", name: "National Capital Region", daily: 755, wageOrder: "NCR-28", effective: "2026-09-26", note: "₱718 for retail/service with 15 or fewer workers and manufacturing with fewer than 10" },
  { region: "CAR", name: "Cordillera", daily: 505, wageOrder: "CAR-24", effective: "2025-12-30" },
  { region: "I", name: "Ilocos", daily: 505, wageOrder: "RB 1-24", effective: "2025-11-19", note: "₱480 for agriculture and smaller establishments" },
  { region: "II", name: "Cagayan Valley", daily: 500, wageOrder: "RTWPB 2-24", effective: "2025-11-05" },
  { region: "III", name: "Central Luzon", daily: 600, wageOrder: "RBIII-26", effective: "2026-04-16", note: "₱560–₱600 by province" },
  { region: "IV-A", name: "CALABARZON", daily: 645, wageOrder: "IVA-23", effective: "2026-10-26", note: "₱550–₱645 by locality" },
  { region: "IV-B", name: "MIMAROPA", daily: 455, wageOrder: "RB-MIMAROPA-13", effective: "2026-01-01" },
  { region: "V", name: "Bicol", daily: 455, wageOrder: "RBV-23", effective: "2026-04-08", note: "Rises to ₱480 on December 1, 2026" },
  { region: "VI", name: "Western Visayas", daily: 590, wageOrder: "VI-30", effective: "2026-11-20", note: "₱565 for 10 or fewer workers" },
  { region: "VII", name: "Central Visayas", daily: 582, wageOrder: "ROVII-27", effective: "2026-10-14", note: "Class A; ₱542 for Class B localities" },
  { region: "VIII", name: "Eastern Visayas", daily: 470, wageOrder: "RB VIII-25", effective: "2026-06-01" },
  { region: "IX", name: "Zamboanga Peninsula", daily: 464, wageOrder: "RIX-24", effective: "2026-06-01" },
  { region: "X", name: "Northern Mindanao", daily: 500, wageOrder: "RX-24", effective: "2026-05-01", note: "₱485–₱500 by locality" },
  { region: "XI", name: "Davao", daily: 540, wageOrder: "RB XI-24", effective: "2026-09-01" },
  { region: "XII", name: "SOCCSKSARGEN", daily: 476, wageOrder: "XII-26", effective: "2026-11-22", note: "Rises to ₱501 on January 1, 2027" },
  { region: "XIII", name: "Caraga", daily: 475, wageOrder: "RXIII-20", effective: "2026-05-01" },
  { region: "BARMM", name: "Bangsamoro", daily: 436, wageOrder: "BARMM-05", effective: "2026-08-06", note: "₱411–₱436; second tranche December 1, 2026" },
];

export const wageFor = (region: PhRegion | null | undefined) => REGIONAL_WAGES.find((w) => w.region === region);
