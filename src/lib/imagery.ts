/**
 * Imagery layers.
 *
 * The storm-day layer is NOAA's own emergency response flight, so its date is
 * certain and comes from NOAA's layer name. Esri's World Imagery carries no
 * queryable acquisition date for this tile block (its metadata layer returns no
 * features here), so it is labelled as an undated reference rather than being
 * passed off as a pre-event capture we cannot prove.
 */
export const IMAGERY = {
  "storm-day": {
    id: "storm-day" as const,
    label: "Storm-day",
    date: "30 September 2022",
    provenance: "NOAA National Geodetic Survey emergency response imagery, flight 20220930d — two days after Ian's landfall. Public domain.",
    url: "https://stormscdn.ngs.noaa.gov/20220930d-rgb/{z}/{x}/{y}",
    attribution: "Imagery: NOAA NGS (public domain)",
    bounds: [-82.3, 25.875, -81.625, 27.038] as [number, number, number, number],
  },
  reference: {
    id: "reference" as const,
    label: "Reference",
    date: "undated",
    provenance: "Esri World Imagery. Shows the neighbourhood intact. Esri publishes no acquisition date for this tile block, so treat it as an undated reference, not a dated pre-event capture.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery: Esri, Maxar, Earthstar Geographics",
    bounds: [-180, -85, 180, 85] as [number, number, number, number],
  },
};

export type ImageryId = keyof typeof IMAGERY;
export const IMAGERY_IDS = Object.keys(IMAGERY) as ImageryId[];
