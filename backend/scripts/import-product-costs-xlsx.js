import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(backendDir, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env") });

const parseArgs = (argv = []) =>
  argv.reduce(
    (result, arg) => {
      if (arg === "--apply") {
        result.apply = true;
        return result;
      }

      if (arg === "--help" || arg === "-h") {
        result.help = true;
        return result;
      }

      const match = arg.match(/^--([^=]+)=(.*)$/);
      if (match) {
        result[match[1]] = match[2];
      }

      return result;
    },
    { apply: false },
  );

const showHelp = () => {
  console.log(`
Import product costs from XLSX into Supabase products table

Usage:
  node scripts/import-product-costs-xlsx.js --file="C:/path/products.xlsx"
  node scripts/import-product-costs-xlsx.js --file="C:/path/products.xlsx" --apply

Optional:
  --sheet=SheetName
  --store-id=<uuid>
  --limit=50

Columns expected:
  Title
  Production Cost
  Ad Spend
`);
};

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeProductTitle = (value) =>
  normalizeText(value)
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*-\s*/g, "-");

const toNullableNumber = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundCurrency = (value) =>
  value === null ? null : Number(Number(value).toFixed(2));

const envValue = (...names) => {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
};

const createSupabaseClient = () => {
  const url = envValue("SUPABASE_URL");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY");

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
};

const readWorkbookRows = ({ file, sheetName = "" }) => {
  const workbook = XLSX.readFile(file);
  const resolvedSheetName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolvedSheetName];

  if (!worksheet) {
    throw new Error(`Sheet not found: ${resolvedSheetName}`);
  }

  return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
};

const buildImportRows = (rows = []) => {
  const dedupedRows = new Map();

  rows.forEach((row, index) => {
    const title = String(row?.Title || "").trim();
    if (!title) {
      return;
    }

    const normalizedTitle = normalizeProductTitle(title);
    const nextCostPrice = roundCurrency(
      toNullableNumber(row?.["Production Cost"]),
    );
    const nextAdsCost = roundCurrency(toNullableNumber(row?.["Ad Spend"]));
    const existing = dedupedRows.get(normalizedTitle);

    if (!existing) {
      dedupedRows.set(normalizedTitle, {
        sourceRowNumbers: [index + 2],
        title,
        normalizedTitle,
        costPrice: nextCostPrice,
        adsCost: nextAdsCost,
      });
      return;
    }

    existing.sourceRowNumbers.push(index + 2);
    if (nextCostPrice !== null) {
      existing.costPrice = nextCostPrice;
    }
    if (nextAdsCost !== null) {
      existing.adsCost = nextAdsCost;
    }
  });

  return Array.from(dedupedRows.values());
};

const fetchCandidateProducts = async ({ supabase, storeId = "" }) => {
  let query = supabase
    .from("products")
    .select("id,title,store_id,cost_price,ads_cost,operation_cost,shipping_cost")
    .limit(5000);

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return data || [];
};

const buildProductIndex = (products = []) => {
  const index = new Map();

  for (const product of products) {
    const normalizedTitle = normalizeProductTitle(product?.title);
    if (!normalizedTitle) {
      continue;
    }

    const existing = index.get(normalizedTitle) || [];
    existing.push(product);
    index.set(normalizedTitle, existing);
  }

  return index;
};

const buildPlan = ({ importRows = [], productIndex, limit = 0 }) => {
  const matched = [];
  const unmatched = [];
  const multiMatchTitles = [];

  for (const row of importRows) {
    const matches = productIndex.get(row.normalizedTitle) || [];

    if (matches.length === 0) {
      unmatched.push(row);
      continue;
    }

    if (matches.length > 1) {
      multiMatchTitles.push({
        row,
        matches: matches.map((product) => ({
          id: product.id,
          title: product.title,
          store_id: product.store_id,
        })),
      });
    }

    matches.forEach((product) => {
      matched.push({
        row,
        product,
        update: {
          cost_price: row.costPrice,
          ads_cost: row.adsCost,
        },
      });
    });
  }

  const limitedMatched =
    limit > 0 ? matched.slice(0, Math.max(0, parseInt(limit, 10) || 0)) : matched;

  return {
    matched: limitedMatched,
    unmatched,
    multiMatchTitles,
    totalMatchedBeforeLimit: matched.length,
  };
};

const applyPlan = async ({ supabase, matched = [] }) => {
  const applied = [];

  for (const entry of matched) {
    const payload = {};
    if (entry.update.cost_price !== null) {
      payload.cost_price = entry.update.cost_price;
    }
    if (entry.update.ads_cost !== null) {
      payload.ads_cost = entry.update.ads_cost;
    }

    if (Object.keys(payload).length === 0) {
      applied.push({
        id: entry.product.id,
        title: entry.product.title,
        skipped: true,
        reason: "No numeric cost fields found in XLSX row",
      });
      continue;
    }

    const { error } = await supabase
      .from("products")
      .update(payload)
      .eq("id", entry.product.id);

    if (error) {
      throw new Error(
        `Failed updating "${entry.product.title}" (${entry.product.id}): ${error.message}`,
      );
    }

    applied.push({
      id: entry.product.id,
      title: entry.product.title,
      payload,
    });
  }

  return applied;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    showHelp();
    process.exit(args.help ? 0 : 1);
  }

  const supabase = createSupabaseClient();
  const importRows = buildImportRows(
    readWorkbookRows({
      file: args.file,
      sheetName: String(args.sheet || "").trim(),
    }),
  );
  const products = await fetchCandidateProducts({
    supabase,
    storeId: String(args["store-id"] || "").trim(),
  });
  const plan = buildPlan({
    importRows,
    productIndex: buildProductIndex(products),
    limit: args.limit,
  });

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    import_rows: importRows.length,
    matched: plan.totalMatchedBeforeLimit,
    unmatched: plan.unmatched.length,
    multi_product_titles: plan.multiMatchTitles.length,
    applying_now: plan.matched.length,
    sample_matches: plan.matched.slice(0, 10).map((entry) => ({
      xlsx_title: entry.row.title,
      product_id: entry.product.id,
      db_title: entry.product.title,
      previous_cost_price: entry.product.cost_price,
      next_cost_price: entry.update.cost_price,
      previous_ads_cost: entry.product.ads_cost,
      next_ads_cost: entry.update.ads_cost,
      source_rows: entry.row.sourceRowNumbers,
    })),
    sample_unmatched: plan.unmatched.slice(0, 10).map((row) => row.title),
    sample_multi_product_titles: plan.multiMatchTitles.slice(0, 5).map((entry) => ({
      xlsx_title: entry.row.title,
      source_rows: entry.row.sourceRowNumbers,
      matches: entry.matches,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!args.apply) {
    return;
  }

  const applied = await applyPlan({
    supabase,
    matched: plan.matched,
  });

  console.log(
    JSON.stringify(
      {
        updated: applied.filter((entry) => !entry.skipped).length,
        skipped: applied.filter((entry) => entry.skipped).length,
        sample_updates: applied.slice(0, 10),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
