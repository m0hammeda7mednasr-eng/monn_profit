import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import dotenv from "dotenv";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(backendDir, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env") });

const DEFAULT_API_VERSION = "2026-04";
const MAX_CELL_LENGTH = 32760;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 5;

const parseArgs = (argv = []) =>
  argv.reduce((result, arg) => {
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      return result;
    }

    if (arg === "--no-json") {
      result.writeJson = false;
      return result;
    }

    if (arg === "--include-metafields") {
      result.includeMetafields = true;
      return result;
    }

    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      result[match[1]] = match[2];
    }

    return result;
  }, { writeJson: true, includeMetafields: false });

const showHelp = () => {
  console.log(`
Export Shopify products to Excel

Usage:
  npm run export:shopify-products
  npm run export:shopify-products -- --output=../exports/products.xlsx

Optional CLI args:
  --shop=moon.myshopify.com
  --token=shpat_...
  --api-version=2026-04
  --store-id=uuid
  --user-id=uuid
  --token-source=auto|env|database
  --output=../exports/products.xlsx
  --json-output=../exports/products.json
  --include-metafields
  --no-json

Env fallbacks:
  SHOPIFY_EXPORT_SHOP, SHOPIFY_BOOTSTRAP_SHOP, SHOPIFY_EMERGENCY_SHOP, SHOPIFY_SHOP
  SHOPIFY_EXPORT_ACCESS_TOKEN, SHOPIFY_BOOTSTRAP_ACCESS_TOKEN, SHOPIFY_EMERGENCY_ACCESS_TOKEN, SHOPIFY_ACCESS_TOKEN
  SHOPIFY_EXPORT_API_VERSION, SHOPIFY_API_VERSION
  SHOPIFY_EXPORT_STORE_ID, SHOPIFY_BOOTSTRAP_STORE_ID
  SHOPIFY_EXPORT_USER_ID, SHOPIFY_BOOTSTRAP_USER_ID
  SHOPIFY_EXPORT_TOKEN_SOURCE
`);
};

const normalizeShopDomain = (value) => {
  let raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  raw = raw.replace(/^https?:\/\//, "").replace(/^www\./, "");

  if (raw.startsWith("admin.shopify.com/store/")) {
    const storeSlug = String(raw.split("/")[2] || "").trim();
    return storeSlug ? `${storeSlug}.myshopify.com` : "";
  }

  raw = raw.split(/[/?#]/)[0];
  if (raw.endsWith(".myshopify.com")) {
    return raw;
  }

  const slug = raw.replace(/[^a-z0-9-]/g, "");
  return slug ? `${slug}.myshopify.com` : "";
};

const envValue = (...names) => {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (value) => {
  const seconds = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

const extractNextPageUrl = (linkHeader = "") => {
  const match = String(linkHeader || "").match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
};

const buildResourceUrl = ({ shop, apiVersion, resource, query = {} }) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return `https://${shop}/admin/api/${apiVersion}/${resource}.json${
    queryString ? `?${queryString}` : ""
  }`;
};

const fetchShopifyPage = async ({ url, accessToken }) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const dataKey = Object.keys(response.data || {})[0];
      const items = Array.isArray(response.data?.[dataKey])
        ? response.data[dataKey]
        : [];

      return {
        items,
        nextPageUrl: extractNextPageUrl(response.headers?.link),
      };
    } catch (error) {
      const status = error.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      if (!retryable || attempt === MAX_RETRIES) {
        const details =
          error.response?.data?.errors ||
          error.response?.data?.error ||
          error.message;
        const requestError = new Error(
          `Shopify request failed (${status || "network"}): ${details}`,
        );
        requestError.status = status;
        throw requestError;
      }

      const retryAfterMs = parseRetryAfterMs(error.response?.headers?.["retry-after"]);
      const fallbackDelayMs = Math.min(30000, 1000 * 2 ** (attempt - 1));
      await sleep(retryAfterMs || fallbackDelayMs);
    }
  }

  return { items: [], nextPageUrl: null };
};

const fetchAllPages = async ({ initialUrl, accessToken, label }) => {
  const items = [];
  let nextUrl = initialUrl;
  let page = 0;

  while (nextUrl) {
    page += 1;
    const result = await fetchShopifyPage({ url: nextUrl, accessToken });
    items.push(...result.items);
    console.log(`[${label}] page=${page} fetched=${result.items.length} total=${items.length}`);
    nextUrl = result.nextPageUrl;
  }

  return items;
};

const createSupabaseClient = () => {
  const url = envValue("SUPABASE_URL");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY");

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
  });
};

const resolveDatabaseCredentialCandidates = async ({ shop, storeId, userId }) => {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("shopify_tokens")
    .select("shop,access_token,user_id,store_id,updated_at")
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (shop) {
    query = query.eq("shop", shop);
  }

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const result = await query;
  if (result.error) {
    console.warn(`Could not read shopify_tokens: ${result.error.message}`);
    return [];
  }

  return (result.data || [])
    .map((row) => ({
      shop: normalizeShopDomain(row.shop),
      accessToken: String(row.access_token || "").trim(),
      source: "database",
      userId: row.user_id || null,
      storeId: row.store_id || null,
      updatedAt: row.updated_at || null,
    }))
    .filter((candidate) => candidate.shop && candidate.accessToken);
};

const resolveCredentialCandidates = async ({ args }) => {
  const requestedShop = normalizeShopDomain(
    args.shop ||
      envValue(
        "SHOPIFY_EXPORT_SHOP",
        "SHOPIFY_BOOTSTRAP_SHOP",
        "SHOPIFY_EMERGENCY_SHOP",
        "SHOPIFY_SHOP",
      ),
  );
  const envAccessToken =
    args.token ||
    envValue(
      "SHOPIFY_EXPORT_ACCESS_TOKEN",
      "SHOPIFY_BOOTSTRAP_ACCESS_TOKEN",
      "SHOPIFY_EMERGENCY_ACCESS_TOKEN",
      "SHOPIFY_ACCESS_TOKEN",
    );
  const tokenSource = String(
    args["token-source"] || envValue("SHOPIFY_EXPORT_TOKEN_SOURCE") || "auto",
  )
    .trim()
    .toLowerCase();
  const storeId =
    args["store-id"] || envValue("SHOPIFY_EXPORT_STORE_ID", "SHOPIFY_BOOTSTRAP_STORE_ID");
  const userId =
    args["user-id"] || envValue("SHOPIFY_EXPORT_USER_ID", "SHOPIFY_BOOTSTRAP_USER_ID");
  const candidates = [];

  if (tokenSource !== "database" && requestedShop && envAccessToken) {
    candidates.push({
      shop: requestedShop,
      accessToken: envAccessToken,
      source: "env",
      userId: userId || null,
      storeId: storeId || null,
    });
  }

  if (tokenSource !== "env") {
    const databaseCandidates = await resolveDatabaseCredentialCandidates({
      shop: requestedShop,
      storeId,
      userId,
    });
    candidates.push(...databaseCandidates);
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.shop}::${candidate.accessToken}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const truncateCell = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= MAX_CELL_LENGTH) return text;

  return `${text.slice(0, MAX_CELL_LENGTH - 80)}... [truncated ${text.length - MAX_CELL_LENGTH} chars]`;
};

const asText = (value) =>
  value === undefined || value === null ? "" : String(value);

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
};

const stripHtml = (value) =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const getVariants = (product) =>
  Array.isArray(product?.variants) ? product.variants : [];

const getImages = (product) =>
  Array.isArray(product?.images) ? product.images : [];

const getOptions = (product) =>
  Array.isArray(product?.options) ? product.options : [];

const getPrices = (variants = []) =>
  variants.map((variant) => Number(variant?.price)).filter(Number.isFinite);

const sumInventory = (variants = []) =>
  variants.reduce((sum, variant) => {
    const quantity = Number(variant?.inventory_quantity);
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

const productRows = (products) =>
  products.map((product) => {
    const variants = getVariants(product);
    const images = getImages(product);
    const options = getOptions(product);
    const prices = getPrices(variants);
    const firstVariant = variants[0] || {};

    return {
      product_id: asText(product.id),
      admin_graphql_api_id: asText(product.admin_graphql_api_id),
      handle: asText(product.handle),
      title: asText(product.title),
      status: asText(product.status),
      vendor: asText(product.vendor),
      product_type: asText(product.product_type),
      tags: asText(product.tags),
      body_text: truncateCell(stripHtml(product.body_html)),
      body_html: truncateCell(product.body_html),
      published_scope: asText(product.published_scope),
      template_suffix: asText(product.template_suffix),
      created_at: asText(product.created_at),
      updated_at: asText(product.updated_at),
      published_at: asText(product.published_at),
      variants_count: variants.length,
      images_count: images.length,
      options: options.map((option) => option?.name).filter(Boolean).join(", "),
      first_variant_id: asText(firstVariant.id),
      first_sku: asText(firstVariant.sku),
      min_price: prices.length > 0 ? Math.min(...prices) : "",
      max_price: prices.length > 0 ? Math.max(...prices) : "",
      total_inventory_quantity: sumInventory(variants),
      featured_image_src: asText(product.image?.src || images[0]?.src),
    };
  });

const variantRows = (products) =>
  products.flatMap((product) =>
    getVariants(product).map((variant) => ({
      product_id: asText(product.id),
      product_title: asText(product.title),
      product_handle: asText(product.handle),
      variant_id: asText(variant.id),
      admin_graphql_api_id: asText(variant.admin_graphql_api_id),
      title: asText(variant.title),
      sku: asText(variant.sku),
      barcode: asText(variant.barcode),
      option1: asText(variant.option1),
      option2: asText(variant.option2),
      option3: asText(variant.option3),
      price: asNumber(variant.price),
      compare_at_price: asNumber(variant.compare_at_price),
      inventory_quantity: asNumber(variant.inventory_quantity),
      old_inventory_quantity: asNumber(variant.old_inventory_quantity),
      inventory_item_id: asText(variant.inventory_item_id),
      inventory_management: asText(variant.inventory_management),
      inventory_policy: asText(variant.inventory_policy),
      fulfillment_service: asText(variant.fulfillment_service),
      taxable: variant.taxable === undefined ? "" : Boolean(variant.taxable),
      tax_code: asText(variant.tax_code),
      requires_shipping:
        variant.requires_shipping === undefined ? "" : Boolean(variant.requires_shipping),
      grams: asNumber(variant.grams),
      weight: asNumber(variant.weight),
      weight_unit: asText(variant.weight_unit),
      position: asNumber(variant.position),
      created_at: asText(variant.created_at),
      updated_at: asText(variant.updated_at),
    })),
  );

const optionRows = (products) =>
  products.flatMap((product) =>
    getOptions(product).map((option) => ({
      product_id: asText(product.id),
      product_title: asText(product.title),
      option_id: asText(option.id),
      name: asText(option.name),
      position: asNumber(option.position),
      values: Array.isArray(option.values) ? option.values.join(", ") : "",
    })),
  );

const imageRows = (products) =>
  products.flatMap((product) =>
    getImages(product).map((image) => ({
      product_id: asText(product.id),
      product_title: asText(product.title),
      image_id: asText(image.id),
      admin_graphql_api_id: asText(image.admin_graphql_api_id),
      position: asNumber(image.position),
      src: asText(image.src),
      width: asNumber(image.width),
      height: asNumber(image.height),
      variant_ids: Array.isArray(image.variant_ids)
        ? image.variant_ids.map(asText).join(", ")
        : "",
      created_at: asText(image.created_at),
      updated_at: asText(image.updated_at),
    })),
  );

const fetchProductMetafields = async ({ products, shop, apiVersion, accessToken }) => {
  const rows = [];

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const metafields = await fetchAllPages({
      label: `metafields ${index + 1}/${products.length}`,
      accessToken,
      initialUrl: buildResourceUrl({
        shop,
        apiVersion,
        resource: `products/${product.id}/metafields`,
        query: { limit: 250 },
      }),
    });

    rows.push(
      ...metafields.map((metafield) => ({
        product_id: asText(product.id),
        product_title: asText(product.title),
        metafield_id: asText(metafield.id),
        namespace: asText(metafield.namespace),
        key: asText(metafield.key),
        type: asText(metafield.type || metafield.value_type),
        value: truncateCell(metafield.value),
        description: asText(metafield.description),
        owner_id: asText(metafield.owner_id),
        owner_resource: asText(metafield.owner_resource),
        created_at: asText(metafield.created_at),
        updated_at: asText(metafield.updated_at),
      })),
    );
  }

  return rows;
};

const addSheet = (workbook, name, rows, headers) => {
  const finalRows = rows.length > 0 ? rows : [Object.fromEntries(headers.map((key) => [key, ""]))];
  const sheet = XLSX.utils.json_to_sheet(finalRows, { header: headers });
  sheet["!cols"] = headers.map((header) => ({
    wch: Math.min(Math.max(header.length + 2, 14), 42),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
};

const buildWorkbook = ({ products, metafields, shop, apiVersion }) => {
  const workbook = XLSX.utils.book_new();
  const variants = variantRows(products);
  const images = imageRows(products);
  const options = optionRows(products);

  addSheet(
    workbook,
    "Summary",
    [
      { key: "generated_at", value: new Date().toISOString() },
      { key: "shop", value: shop },
      { key: "api_version", value: apiVersion },
      { key: "products_count", value: products.length },
      { key: "variants_count", value: variants.length },
      { key: "options_count", value: options.length },
      { key: "images_count", value: images.length },
      { key: "metafields_count", value: metafields.length },
    ],
    ["key", "value"],
  );

  addSheet(workbook, "Products", productRows(products), [
    "product_id",
    "admin_graphql_api_id",
    "handle",
    "title",
    "status",
    "vendor",
    "product_type",
    "tags",
    "body_text",
    "body_html",
    "published_scope",
    "template_suffix",
    "created_at",
    "updated_at",
    "published_at",
    "variants_count",
    "images_count",
    "options",
    "first_variant_id",
    "first_sku",
    "min_price",
    "max_price",
    "total_inventory_quantity",
    "featured_image_src",
  ]);

  addSheet(workbook, "Variants", variants, [
    "product_id",
    "product_title",
    "product_handle",
    "variant_id",
    "admin_graphql_api_id",
    "title",
    "sku",
    "barcode",
    "option1",
    "option2",
    "option3",
    "price",
    "compare_at_price",
    "inventory_quantity",
    "old_inventory_quantity",
    "inventory_item_id",
    "inventory_management",
    "inventory_policy",
    "fulfillment_service",
    "taxable",
    "tax_code",
    "requires_shipping",
    "grams",
    "weight",
    "weight_unit",
    "position",
    "created_at",
    "updated_at",
  ]);

  addSheet(workbook, "Options", options, [
    "product_id",
    "product_title",
    "option_id",
    "name",
    "position",
    "values",
  ]);

  addSheet(workbook, "Images", images, [
    "product_id",
    "product_title",
    "image_id",
    "admin_graphql_api_id",
    "position",
    "src",
    "width",
    "height",
    "variant_ids",
    "created_at",
    "updated_at",
  ]);

  if (metafields.length > 0) {
    addSheet(workbook, "Metafields", metafields, [
      "product_id",
      "product_title",
      "metafield_id",
      "namespace",
      "key",
      "type",
      "value",
      "description",
      "owner_id",
      "owner_resource",
      "created_at",
      "updated_at",
    ]);
  }

  return workbook;
};

const safeFileName = (value) =>
  String(value || "shopify")
    .replace(/[^a-z0-9.-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const resolveOutputPaths = ({ args, shop }) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportDir = path.join(repoRoot, "exports");
  const baseName = `${safeFileName(shop)}-products-backup-${timestamp}`;

  return {
    workbookPath: path.resolve(
      args.output ||
        process.env.SHOPIFY_EXPORT_OUTPUT ||
        path.join(exportDir, `${baseName}.xlsx`),
    ),
    jsonPath: path.resolve(
      args["json-output"] ||
        process.env.SHOPIFY_EXPORT_JSON_OUTPUT ||
        path.join(exportDir, `${baseName}.json`),
    ),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    showHelp();
    return;
  }

  const apiVersion =
    args["api-version"] ||
    envValue("SHOPIFY_EXPORT_API_VERSION", "SHOPIFY_API_VERSION") ||
    DEFAULT_API_VERSION;
  const includeMetafields =
    args.includeMetafields ||
    String(process.env.SHOPIFY_EXPORT_INCLUDE_METAFIELDS || "")
      .trim()
      .toLowerCase() === "true";

  const credentialCandidates = await resolveCredentialCandidates({ args });
  if (credentialCandidates.length === 0) {
    throw new Error(
      "Missing Shopify connection. Set Shopify env vars, reconnect Shopify in the app, or ensure shopify_tokens has a saved token.",
    );
  }

  let activeCredential = null;
  let products = [];
  let lastAuthError = null;

  for (const candidate of credentialCandidates) {
    try {
      console.log(`Trying Shopify token source=${candidate.source}, shop=${candidate.shop}`);
      products = await fetchAllPages({
        label: "products",
        accessToken: candidate.accessToken,
        initialUrl: buildResourceUrl({
          shop: candidate.shop,
          apiVersion,
          resource: "products",
          query: { limit: 250, published_status: "any" },
        }),
      });
      activeCredential = candidate;
      break;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        lastAuthError = error;
        console.warn(
          `Shopify token source=${candidate.source} was rejected for ${candidate.shop}. Trying next saved token if available.`,
        );
        continue;
      }

      throw error;
    }
  }

  if (!activeCredential) {
    throw lastAuthError || new Error("No valid Shopify token was found.");
  }

  const metafields = includeMetafields
    ? await fetchProductMetafields({
        products,
        shop: activeCredential.shop,
        apiVersion,
        accessToken: activeCredential.accessToken,
      })
    : [];

  const { workbookPath, jsonPath } = resolveOutputPaths({
    args,
    shop: activeCredential.shop,
  });
  await fs.mkdir(path.dirname(workbookPath), { recursive: true });
  const workbook = buildWorkbook({
    products,
    metafields,
    shop: activeCredential.shop,
    apiVersion,
  });
  XLSX.writeFile(workbook, workbookPath, { compression: true });

  if (args.writeJson) {
    await fs.mkdir(path.dirname(jsonPath), { recursive: true });
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          shop: activeCredential.shop,
          api_version: apiVersion,
          credential_source: activeCredential.source,
          products,
          metafields,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  console.log(
    JSON.stringify(
      {
        shop: activeCredential.shop,
        api_version: apiVersion,
        credential_source: activeCredential.source,
        user_id: activeCredential.userId,
        store_id: activeCredential.storeId,
        products_count: products.length,
        variants_count: variantRows(products).length,
        images_count: imageRows(products).length,
        options_count: optionRows(products).length,
        metafields_count: metafields.length,
        workbook_path: workbookPath,
        json_path: args.writeJson ? jsonPath : null,
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
