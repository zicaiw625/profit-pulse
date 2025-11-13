import prisma from "../db.server";

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listTaxRates(storeId) {
  if (!storeId) return [];
  return prisma.taxRate.findMany({
    where: { storeId },
    orderBy: { country: "asc" },
  });
}

export async function importTaxRatesFromCsv({ storeId, csv }) {
  if (!storeId) {
    throw new Error("Store is required to import tax rates");
  }
  if (!csv) {
    throw new Error("CSV content is required to import tax rates");
  }

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("CSV file is empty");
  }

  const headers = lines[0]
    .split(",")
    .map((header) => header.trim().toLowerCase());

  const countryIdx = headers.indexOf("country");
  const stateIdx = headers.indexOf("state");
  const rateIdx = headers.indexOf("rate");
  const fromIdx = headers.indexOf("effective_from");
  const toIdx = headers.indexOf("effective_to");
  const notesIdx = headers.indexOf("notes");

  if (countryIdx === -1 || rateIdx === -1) {
    throw new Error("CSV must include country and rate columns");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    const country = (parts[countryIdx] ?? "").trim();
    if (!country) continue;
    const rate = toNumber(parts[rateIdx]);
    if (rate <= 0) continue;
    const state = stateIdx !== -1 ? (parts[stateIdx] ?? "").trim() : null;
    const notes = notesIdx !== -1 ? (parts[notesIdx] ?? "").trim() : null;
    const effectiveFrom = parseDate(
      fromIdx !== -1 ? parts[fromIdx]?.trim() : null,
    );
    const effectiveTo = parseDate(
      toIdx !== -1 ? parts[toIdx]?.trim() : null,
    );

    rows.push({
      storeId,
      country,
      state: state || null,
      rate,
      effectiveFrom,
      effectiveTo,
      notes: notes || null,
    });
  }

  if (!rows.length) {
    throw new Error("No valid tax rows detected in CSV");
  }

  await prisma.taxRate.createMany({
    data: rows,
  });

  return rows.length;
}
