import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  Download,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShoppingCart,
  User,
  Users,
} from "lucide-react";
import api, { shopifyAPI } from "../utils/api";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { fetchAllPagesProgressively } from "../utils/pagination";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  peekCachedView,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";
import {
  HEAVY_VIEW_CACHE_FRESH_MS,
  shouldAutoRefreshView,
} from "../utils/refreshPolicy";
import { buildCsvFilename, downloadCsvSections } from "../utils/csv";
import {
  formatCurrency as formatAmount,
  formatDate,
  formatNumber,
  formatTime,
} from "../utils/localeFormat";

const CUSTOMERS_PAGE_SIZE = 200;
const ORDERS_PAGE_SIZE = 200;
const CUSTOMER_ORDER_SCAN_PAGES = 4;
const CUSTOMERS_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
const CITY_STOP_WORDS = new Set([
  "el",
  "al",
  "governorate",
  "governorat",
  "gov",
  "محافظة",
  "محافظه",
]);
const KNOWN_CITY_GROUPS = [
  ["cairo", ["cairo", "القاهرة", "القاهره"]],
  ["giza", ["giza", "جيزة", "الجيزة", "الجيزه"]],
  ["alexandria", ["alexandria", "alex", "الإسكندرية", "الاسكندرية", "اسكندرية"]],
  ["nasr city", ["nasr city", "مدينة نصر", "مدينه نصر", "madinet nasr", "madinat nasr"]],
  ["maadi", ["maadi", "المعادي", "المعادى", "el maadi"]],
  ["heliopolis", ["heliopolis", "مصر الجديدة", "مصر الجديده", "masr el gdida", "masr el gedida"]],
  ["new cairo", ["new cairo", "القاهرة الجديدة", "القاهره الجديده", "التجمع", "التجمع الخامس", "tagamoa", "tagamo3"]],
  ["6 october", ["6 october", "6th october", "october", "اكتوبر", "٦ اكتوبر", "السادس من اكتوبر"]],
  ["sheikh zayed", ["sheikh zayed", "zayed", "الشيخ زايد"]],
  ["faisal", ["faisal", "فيصل"]],
  ["haram", ["haram", "الهرم"]],
  ["mansoura", ["mansoura", "المنصورة", "المنصوره"]],
  ["tanta", ["tanta", "طنطا"]],
  ["zagazig", ["zagazig", "الزقازيق", "زقازيق"]],
  ["ismailia", ["ismailia", "الإسماعيلية", "الاسماعيلية", "اسماعيلية"]],
  ["port said", ["port said", "بورسعيد", "portsaid"]],
  ["suez", ["suez", "السويس", "سويس"]],
  ["damietta", ["damietta", "دمياط"]],
  ["minya", ["minya", "المنيا", "منيا"]],
  ["asyut", ["asyut", "أسيوط", "اسيوط"]],
  ["luxor", ["luxor", "الأقصر", "الاقصر", "اقصر"]],
  ["aswan", ["aswan", "أسوان", "اسوان"]],
];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseJson = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
};

const normalizeRepeatedCharacters = (value) =>
  String(value || "").replace(/(.)\1{2,}/g, "$1$1");

const normalizeCityText = (value) =>
  normalizeRepeatedCharacters(
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/چ/g, "ج")
      .replace(/گ/g, "ك")
      .replace(/[^a-z0-9\u0600-\u06ff\s]/g, " ")
      .replace(/\s+/g, " "),
  ).trim();

const tokenizeCity = (value) =>
  normalizeCityText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !CITY_STOP_WORDS.has(token));

const buildCityKey = (value) => tokenizeCity(value).join(" ");

const buildSortedCityKey = (value) => [...tokenizeCity(value)].sort().join(" ");

const compactCityKey = (value) => buildCityKey(value).replace(/\s+/g, "");

const levenshteinDistance = (left, right) => {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0),
  );

  for (let row = 0; row <= left.length; row += 1) {
    matrix[row][0] = row;
  }
  for (let column = 0; column <= right.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
};

const computeStringSimilarity = (left, right) => {
  const safeLeft = String(left || "").trim();
  const safeRight = String(right || "").trim();
  if (!safeLeft || !safeRight) return 0;
  if (safeLeft === safeRight) return 1;

  const distance = levenshteinDistance(safeLeft, safeRight);
  return 1 - distance / Math.max(safeLeft.length, safeRight.length, 1);
};

const pickMostFrequentLabel = (labelCounts = new Map()) =>
  [...labelCounts.entries()].sort((left, right) => {
    const countDelta = right[1] - left[1];
    if (countDelta !== 0) return countDelta;
    return String(left[0] || "").localeCompare(String(right[0] || ""));
  })[0]?.[0] || "";

const resolveKnownCityKey = (value) => {
  const key = buildCityKey(value);
  const sortedKey = buildSortedCityKey(value);
  const compactKey = compactCityKey(value);

  if (!key && !compactKey) {
    return "";
  }

  for (const [groupKey, aliases] of KNOWN_CITY_GROUPS) {
    const matched = aliases.some((alias) => {
      const aliasKey = buildCityKey(alias);
      const aliasSortedKey = buildSortedCityKey(alias);
      const aliasCompactKey = compactCityKey(alias);

      return (
        aliasKey === key ||
        aliasSortedKey === sortedKey ||
        aliasCompactKey === compactKey
      );
    });

    if (matched) {
      return groupKey;
    }
  }

  return "";
};

const createCityCandidate = (value) => ({
  raw: String(value || "").trim(),
  key: buildCityKey(value),
  sortedKey: buildSortedCityKey(value),
  compactKey: compactCityKey(value),
});

const getCitySimilarityScore = (leftValue, rightValue) => {
  const left = typeof leftValue === "string" ? createCityCandidate(leftValue) : leftValue;
  const right =
    typeof rightValue === "string" ? createCityCandidate(rightValue) : rightValue;

  if (!left.key || !right.key) {
    return 0;
  }

  if (
    left.key === right.key ||
    left.sortedKey === right.sortedKey ||
    left.compactKey === right.compactKey
  ) {
    return 1;
  }

  if (
    left.key.includes(right.key) ||
    right.key.includes(left.key) ||
    left.compactKey.includes(right.compactKey) ||
    right.compactKey.includes(left.compactKey)
  ) {
    return 0.94;
  }

  return Math.max(
    computeStringSimilarity(left.compactKey, right.compactKey),
    computeStringSimilarity(left.sortedKey, right.sortedKey),
  );
};

const buildCityRegistry = (customers = []) => {
  const groups = new Map();

  (customers || []).forEach((customer) => {
    const rawCity = String(customer?.city || "").trim();
    if (!rawCity) {
      return;
    }

    const knownKey = resolveKnownCityKey(rawCity);
    const candidate = createCityCandidate(rawCity);

    let groupKey = knownKey || candidate.key || candidate.compactKey;

    if (!knownKey) {
      const bestGroup = [...groups.values()].reduce(
        (best, currentGroup) => {
          const score = getCitySimilarityScore(candidate, currentGroup.candidate);
          if (!best || score > best.score) {
            return { group: currentGroup, score };
          }
          return best;
        },
        null,
      );

      if (bestGroup && bestGroup.score >= 0.83) {
        groupKey = bestGroup.group.key;
      }
    }

    const currentGroup = groups.get(groupKey) || {
      key: groupKey,
      candidate,
      labelCounts: new Map(),
      variants: new Set(),
      searchKeys: new Set(),
      count: 0,
    };

    currentGroup.count += 1;
    currentGroup.variants.add(rawCity);
    currentGroup.searchKeys.add(candidate.key);
    currentGroup.searchKeys.add(candidate.sortedKey);
    currentGroup.searchKeys.add(candidate.compactKey);
    currentGroup.labelCounts.set(
      rawCity,
      (currentGroup.labelCounts.get(rawCity) || 0) + 1,
    );

    groups.set(groupKey, currentGroup);
  });

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      count: group.count,
      label: pickMostFrequentLabel(group.labelCounts) || group.candidate.raw,
      variants: [...group.variants].sort((a, b) => a.localeCompare(b)),
      searchKeys: [...group.searchKeys].filter(Boolean),
      candidate: group.candidate,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const resolveCityOption = (value, cityOptions = []) => {
  const query = String(value || "").trim();
  if (!query) return null;

  const candidate = createCityCandidate(query);
  if (!candidate.key && !candidate.compactKey) {
    return null;
  }

  const bestMatch = (cityOptions || []).reduce((best, option) => {
    const optionScore = Math.max(
      getCitySimilarityScore(candidate, option.candidate),
      ...option.searchKeys.map((searchKey) =>
        computeStringSimilarity(candidate.compactKey, String(searchKey || "").replace(/\s+/g, "")),
      ),
    );

    if (!best || optionScore > best.score) {
      return { option, score: optionScore };
    }
    return best;
  }, null);

  if (!bestMatch) {
    return null;
  }

  const requiredScore = candidate.compactKey.length <= 4 ? 0.88 : 0.72;
  return bestMatch.score >= requiredScore ? bestMatch.option : null;
};

const matchesCityFilter = (customer, query, resolvedOption) => {
  const normalizedQuery = createCityCandidate(query);
  if (!normalizedQuery.key && !normalizedQuery.compactKey) {
    return true;
  }

  const customerSearchKeys = [
    customer?.city_group_key,
    createCityCandidate(customer?.city || "").key,
    createCityCandidate(customer?.city || "").compactKey,
    createCityCandidate(customer?.city_display || "").key,
    createCityCandidate(customer?.city_display || "").compactKey,
  ].filter(Boolean);

  if (
    resolvedOption &&
    customerSearchKeys.some((value) => String(value) === resolvedOption.key)
  ) {
    return true;
  }

  return customerSearchKeys.some((value) => {
    const safeValue = String(value || "");
    return (
      safeValue.includes(normalizedQuery.key) ||
      safeValue.includes(normalizedQuery.compactKey) ||
      normalizedQuery.key.includes(safeValue) ||
      computeStringSimilarity(
        normalizedQuery.compactKey,
        safeValue.replace(/\s+/g, ""),
      ) >= 0.72
    );
  });
};

const resolveCustomerPhone = (customer) => {
  const data = parseJson(customer?.data);
  const addresses = Array.isArray(data?.addresses) ? data.addresses : [];

  return (
    String(customer?.phone || "").trim() ||
    String(data?.phone || "").trim() ||
    String(data?.default_address?.phone || "").trim() ||
    addresses.map((address) => String(address?.phone || "").trim()).find(Boolean) ||
    ""
  );
};

const normalizeCustomerRow = (customer) => ({
  ...customer,
  phone: resolveCustomerPhone(customer),
  city:
    String(customer?.city || "").trim() ||
    String(parseJson(customer?.data)?.default_address?.city || "").trim(),
  country:
    String(customer?.country || "").trim() ||
    String(parseJson(customer?.data)?.default_address?.country || "").trim(),
  default_address:
    String(customer?.default_address || "").trim() ||
    String(parseJson(customer?.data)?.default_address?.address1 || "").trim(),
});

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const getOrderCustomerId = (order) =>
  String(order?.customer_shopify_id || order?.customer_id || "");

const getOrderFinancialStatus = (order) => {
  return String(
    order?.financial_status || order?.status || "",
  )
    .toLowerCase()
    .trim();
};
const isCustomersRelatedSharedUpdate = (event) => {
  const source = String(event?.source || "").toLowerCase();
  if (!source) {
    return true;
  }

  return (
    source.includes("/shopify/customers") ||
    source.includes("/customers/") ||
    source.includes("/shopify/orders") ||
    source.includes("/orders/")
  );
};

export default function Customers() {
  const { hasPermission } = useAuth();
  const { isRTL, select } = useLocale();
  const canViewOrders = hasPermission("can_view_orders");
  const tableHeaderAlignClass = isRTL ? "text-right" : "text-left";
  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey("customers:list"),
    [],
  );
  const initialCachedSnapshot = useMemo(() => {
    const cached = peekCachedView(cacheKey);
    return {
      rows: Array.isArray(cached?.value?.customers)
        ? cached.value.customers.map((customer) => normalizeCustomerRow(customer))
        : [],
      updatedAt: cached?.updatedAt ? new Date(cached.updatedAt) : null,
    };
  }, [cacheKey]);

  const [customers, setCustomers] = useState(() => initialCachedSnapshot.rows);
  const [orders, setOrders] = useState([]);
  const [, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState(null);
  const [selectedCustomerLoading, setSelectedCustomerLoading] = useState(false);
  const [relatedOrdersLoading, setRelatedOrdersLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    () => initialCachedSnapshot.updatedAt,
  );
  const [loadStatus, setLoadStatus] = useState({
    active: false,
    message: "",
  });
  const fetchPromiseRef = useRef(null);
  const customersRef = useRef([]);

  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  useEffect(() => {
    let active = true;

    readCachedView(cacheKey).then((cached) => {
      const cachedCustomers = Array.isArray(cached?.value?.customers)
        ? cached.value.customers
        : [];

      if (!active || cachedCustomers.length === 0 || cachedCustomers.length <= customersRef.current.length) {
        return;
      }

      setCustomers(cachedCustomers.map((customer) => normalizeCustomerRow(customer)));
      setOrders([]);
      setLastUpdatedAt(
        cached?.updatedAt ? new Date(cached.updatedAt) : new Date(),
      );
      setLoadStatus({
        active: false,
        message: `Showing ${formatNumber(cachedCustomers.length, {
          maximumFractionDigits: 0,
        })} cached customers`,
      });
    });

    return () => {
      active = false;
    };
  }, [cacheKey, canViewOrders]);

  const fetchData = useCallback(
    async ({ silent = false } = {}) => {
      if (fetchPromiseRef.current) {
        return fetchPromiseRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setLoading(false);
          setError("");
        }

        setLoadStatus({
          active: true,
          message: select(
            "\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0639\u0644\u0649 \u062f\u0641\u0639\u0627\u062a...",
            "Loading customers in batches...",
          ),
        });

        try {
          const customersData = await fetchAllPagesProgressively(
            ({ limit, offset }) =>
              api.get("/shopify/customers", {
                params: {
                  limit,
                  offset,
                  sort_by: "created_at",
                  sort_dir: "desc",
                  include_data: 0,
                  include_order_phone_fallback: 0,
                },
              }),
            {
              limit: CUSTOMERS_PAGE_SIZE,
              onPage: ({ rows: accumulatedRows, hasMore }) => {
                setCustomers(accumulatedRows);
                setLastUpdatedAt(new Date());
                setLoadStatus({
                  active: hasMore,
                  message: hasMore
                    ? select(
                        `\u062a\u0645 \u062a\u062d\u0645\u064a\u0644 ${formatNumber(accumulatedRows.length, {
                          maximumFractionDigits: 0,
                        })} \u0639\u0645\u064a\u0644 \u062d\u062a\u0649 \u0627\u0644\u0622\u0646...`,
                        `Loaded ${formatNumber(accumulatedRows.length, {
                          maximumFractionDigits: 0,
                        })} customers so far...`,
                      )
                    : select(
                        `\u062a\u0645 \u062a\u062d\u0645\u064a\u0644 ${formatNumber(accumulatedRows.length, {
                          maximumFractionDigits: 0,
                        })} \u0639\u0645\u064a\u0644`,
                        `Loaded ${formatNumber(accumulatedRows.length, {
                          maximumFractionDigits: 0,
                        })} customers`,
                      ),
                });
              },
            },
          );

          const normalizedCustomers = customersData.map((customer) =>
            normalizeCustomerRow(customer),
          );
          setCustomers(normalizedCustomers);
          setOrders([]);
          setLastUpdatedAt(new Date());
          setLoadStatus({
            active: false,
            message:
              normalizedCustomers.length > 0
                ? select(
                    `\u062a\u0645 \u062a\u062d\u0645\u064a\u0644 ${formatNumber(normalizedCustomers.length, {
                      maximumFractionDigits: 0,
                    })} \u0639\u0645\u064a\u0644`,
                    `Loaded ${formatNumber(normalizedCustomers.length, {
                      maximumFractionDigits: 0,
                    })} customers`,
                  )
                : select(
                    "\u0644\u0627 \u064a\u0648\u062c\u062f \u0639\u0645\u0644\u0627\u0621",
                    "No customers found",
                  ),
          });
          await writeCachedView(cacheKey, {
            customers: normalizedCustomers,
          });
        } catch (requestError) {
          console.error("Failed to fetch customers:", requestError);
          if (!silent) {
            if (customersRef.current.length === 0) {
              setCustomers([]);
              setOrders([]);
              setError("Failed to load customers");
            } else {
              setError("Showing saved customers while refresh failed");
            }
          }
          setLoadStatus((current) =>
            current.message && customersRef.current.length > 0
              ? { active: false, message: current.message }
              : { active: false, message: "" },
          );
        } finally {
          setLoading(false);
        }
      })();

      fetchPromiseRef.current = request;

      try {
        await request;
      } finally {
        fetchPromiseRef.current = null;
      }
    },
    [cacheKey, select],
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const cached = await readCachedView(cacheKey);
      if (!active) {
        return;
      }

      const hasCachedRows =
        Array.isArray(cached?.value?.customers) && cached.value.customers.length > 0;
      if (!hasCachedRows || !isCacheFresh(cached, CUSTOMERS_CACHE_FRESH_MS)) {
        await fetchData({ silent: hasCachedRows });
      }
    })();

    let unsubscribe = () => {};
    let onFocus = null;
    let interval = null;

    if (shouldAutoRefreshView()) {
      unsubscribe = subscribeToSharedDataUpdates((event) => {
        if (!isCustomersRelatedSharedUpdate(event)) {
          return;
        }

        fetchData({ silent: true });
      });

      interval = setInterval(() => {
        if (document.visibilityState !== "visible") {
          return;
        }

        fetchData({ silent: true });
      }, CUSTOMERS_CACHE_FRESH_MS);

      onFocus = async () => {
        const cached = await readCachedView(cacheKey);
        if (isCacheFresh(cached, CUSTOMERS_CACHE_FRESH_MS)) {
          return;
        }

        fetchData({ silent: true });
      };
      window.addEventListener("focus", onFocus);
    }

    return () => {
      active = false;
      if (interval) {
        clearInterval(interval);
      }
      unsubscribe();
      if (onFocus) {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [cacheKey, fetchData]);

  const loadSelectedCustomerOrders = useCallback(
    async (customer) => {
      if (!canViewOrders || !customer) {
        setOrders([]);
        setRelatedOrdersLoading(false);
        return;
      }

      const customerId = String(customer.shopify_id || "").trim();
      const customerEmail = normalizeText(customer.email);
      const matchedOrders = [];
      const seenOrderIds = new Set();

      setRelatedOrdersLoading(true);
      setOrders([]);

      try {
        await fetchAllPagesProgressively(
          ({ limit, offset }) =>
            shopifyAPI.getOrders({
              limit,
              offset,
              sort_by: "created_at",
              sort_dir: "desc",
              sync_recent: "false",
            }),
          {
            limit: ORDERS_PAGE_SIZE,
            maxPages: CUSTOMER_ORDER_SCAN_PAGES,
            onPage: ({ batch, pageIndex }) => {
              batch.forEach((order) => {
                const byEmail =
                  customerEmail &&
                  normalizeText(order.customer_email) === customerEmail;
                const byId = customerId && getOrderCustomerId(order) === customerId;
                if (!byEmail && !byId) {
                  return;
                }

                const orderId = String(order.id || order.shopify_id || "");
                if (!orderId || seenOrderIds.has(orderId)) {
                  return;
                }

                seenOrderIds.add(orderId);
                matchedOrders.push(order);
              });

              matchedOrders.sort(
                (a, b) => new Date(b.created_at) - new Date(a.created_at),
              );
              setOrders([...matchedOrders].slice(0, 8));

              return matchedOrders.length < 8 && pageIndex + 1 < CUSTOMER_ORDER_SCAN_PAGES;
            },
          },
        );
      } catch (requestError) {
        console.error("Failed to fetch related customer orders:", requestError);
      } finally {
        setRelatedOrdersLoading(false);
      }
    },
    [canViewOrders],
  );

  useEffect(() => {
    if (!selectedCustomer) {
      setSelectedCustomerDetails(null);
      setSelectedCustomerLoading(false);
      setOrders([]);
      setRelatedOrdersLoading(false);
      return;
    }

    loadSelectedCustomerOrders(selectedCustomer);
  }, [loadSelectedCustomerOrders, selectedCustomer]);

  useEffect(() => {
    if (!selectedCustomer?.id) {
      setSelectedCustomerDetails(null);
      setSelectedCustomerLoading(false);
      return;
    }

    let active = true;
    setSelectedCustomerLoading(true);

    api
      .get(`/shopify/customers/${selectedCustomer.id}`)
      .then((response) => {
        if (!active) {
          return;
        }

        setSelectedCustomerDetails(normalizeCustomerRow(response?.data || {}));
      })
      .catch((requestError) => {
        console.error("Failed to load customer details:", requestError);
        if (!active) {
          return;
        }

        setSelectedCustomerDetails(null);
      })
      .finally(() => {
        if (!active) {
          return;
        }

        setSelectedCustomerLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCustomer]);

  const cityOptions = useMemo(() => buildCityRegistry(customers), [customers]);

  const customersWithResolvedCities = useMemo(() => {
    const resolutionCache = new Map();

    const resolveCustomerCity = (city) => {
      const rawCity = String(city || "").trim();
      if (!rawCity) {
        return null;
      }

      if (!resolutionCache.has(rawCity)) {
        resolutionCache.set(rawCity, resolveCityOption(rawCity, cityOptions));
      }

      return resolutionCache.get(rawCity);
    };

    return customers.map((customer) => {
      const resolvedCity = resolveCustomerCity(customer.city);
      const fallbackKey =
        buildCityKey(customer.city) || compactCityKey(customer.city) || "";

      return {
        ...customer,
        city_display: resolvedCity?.label || customer.city,
        city_group_key: resolvedCity?.key || fallbackKey,
        city_variants: resolvedCity?.variants || [],
      };
    });
  }, [cityOptions, customers]);

  const resolvedCityFilter = useMemo(
    () => resolveCityOption(cityFilter, cityOptions),
    [cityFilter, cityOptions],
  );

  const countryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          customers
            .map((customer) => String(customer.country || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [customers],
  );

  const filteredCustomers = useMemo(() => {
    let result = [...customersWithResolvedCities];

    if (searchTerm.trim()) {
      const query = normalizeText(searchTerm);
      result = result.filter((customer) => {
        const name = normalizeText(customer.name);
        const email = normalizeText(customer.email);
        const phone = normalizeText(customer.phone);
        const city = normalizeText(customer.city);
        const cityDisplay = normalizeText(customer.city_display);
        const country = normalizeText(customer.country);
        return (
          name.includes(query) ||
          email.includes(query) ||
          phone.includes(query) ||
          city.includes(query) ||
          cityDisplay.includes(query) ||
          country.includes(query)
        );
      });
    }

    if (cityFilter.trim()) {
      result = result.filter(
        (customer) => matchesCityFilter(customer, cityFilter, resolvedCityFilter),
      );
    }

    if (countryFilter !== "all") {
      result = result.filter(
        (customer) =>
          normalizeText(customer.country) === normalizeText(countryFilter),
      );
    }

    result.sort((a, b) => toNumber(b.total_spent) - toNumber(a.total_spent));
    return result;
  }, [
    cityFilter,
    countryFilter,
    customersWithResolvedCities,
    resolvedCityFilter,
    searchTerm,
  ]);

  const cityFilterHint = useMemo(() => {
    if (!cityFilter.trim()) {
      return select(
        "اكتب المدينة بالعربي أو الإنجليزي وسيتم تجميع الكتابات المتشابهة تلقائيًا.",
        "Type the city in Arabic or English. Similar spellings will be grouped automatically.",
      );
    }

    if (resolvedCityFilter) {
      return select(
        `سيتم الفلترة على ${resolvedCityFilter.label} ويشمل ${formatNumber(
          resolvedCityFilter.variants.length,
          {
            maximumFractionDigits: 0,
          },
        )} كتابة مشابهة.`,
        `Filtering by ${resolvedCityFilter.label} across ${formatNumber(
          resolvedCityFilter.variants.length,
          {
            maximumFractionDigits: 0,
          },
        )} similar spellings.`,
      );
    }

    return select(
      "سيتم البحث بأقرب مطابقة متاحة حتى لو كانت الكتابة غير دقيقة.",
      "The closest available city match will be used even if the spelling is not exact.",
    );
  }, [cityFilter, resolvedCityFilter, select]);

  const summary = useMemo(() => {
    const totalCustomers = filteredCustomers.length;
    const totalOrders = filteredCustomers.reduce(
      (sum, customer) => sum + toNumber(customer.orders_count),
      0,
    );
    const totalSpent = filteredCustomers.reduce(
      (sum, customer) => sum + toNumber(customer.total_spent),
      0,
    );
    const avgSpent = totalCustomers > 0 ? totalSpent / totalCustomers : 0;

    return {
      totalCustomers,
      totalOrders,
      totalSpent,
      avgSpent,
    };
  }, [filteredCustomers]);

  const exportCustomers = useCallback(() => {
    downloadCsvSections({
      filename: buildCsvFilename("customers-view"),
      sections: [
        {
          title: select("بيانات التصفية", "Filter metadata"),
          headers: [select("الحقل", "Field"), select("القيمة", "Value")],
          rows: [
            [select("البحث", "Search"), searchTerm.trim() || "-"],
            [
              select("المدينة", "City"),
              resolvedCityFilter?.label || cityFilter.trim() || select("الكل", "All"),
            ],
            [
              select("الدولة", "Country"),
              countryFilter === "all" ? select("الكل", "All") : countryFilter,
            ],
            [select("النتائج", "Results"), filteredCustomers.length],
            [select("وقت التصدير", "Exported at"), new Date().toISOString()],
          ],
        },
        {
          title: select("العملاء الظاهرون", "Visible customers"),
          headers: [
            select("الاسم", "Name"),
            select("البريد", "Email"),
            select("الهاتف", "Phone"),
            select("المدينة المعروضة", "Resolved city"),
            select("المدينة الأصلية", "Original city"),
            select("الدولة", "Country"),
            select("العنوان", "Address"),
            select("عدد الطلبات", "Orders"),
            select("إجمالي الإنفاق", "Total spent"),
            select("تاريخ الانضمام", "Joined"),
          ],
          rows: filteredCustomers.map((customer) => [
            customer.name || "Unknown",
            customer.email || "",
            customer.phone || "",
            customer.city_display || customer.city || "",
            customer.city || "",
            customer.country || "",
            customer.default_address || "",
            toNumber(customer.orders_count),
            toNumber(customer.total_spent),
            customer.created_at || "",
          ]),
        },
      ],
    });
  }, [
    cityFilter,
    countryFilter,
    filteredCustomers,
    resolvedCityFilter?.label,
    searchTerm,
    select,
  ]);

  const selectedCustomerRecord = useMemo(() => {
    if (!selectedCustomer) {
      return null;
    }

    if (
      selectedCustomerDetails?.id &&
      String(selectedCustomerDetails.id) === String(selectedCustomer.id)
    ) {
      return {
        ...selectedCustomer,
        ...selectedCustomerDetails,
      };
    }

    return selectedCustomer;
  }, [selectedCustomer, selectedCustomerDetails]);

  const selectedCustomerMeta = useMemo(() => {
    if (!selectedCustomerRecord) return null;
    const data = parseJson(selectedCustomerRecord.data);

    return {
      data,
      relatedOrders: canViewOrders ? orders.slice(0, 8) : [],
      tags: Array.isArray(selectedCustomerRecord.tags)
        ? selectedCustomerRecord.tags
        : Array.isArray(data.tags)
          ? data.tags
          : String(data.tags || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
      lastOrderName:
        selectedCustomerRecord.last_order_name ||
        data.last_order_name ||
        data.last_order?.name ||
        "",
      defaultAddress:
        selectedCustomerRecord.default_address_details || data.default_address || {},
    };
  }, [canViewOrders, orders, selectedCustomerRecord]);

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
              <p className="text-slate-600">
                Detailed customer profiles with spend, location, and order activity.
              </p>
              {lastUpdatedAt && (
                <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                  <Clock3 size={12} />
                  {select("\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b", "Last refresh")}: {formatTime(lastUpdatedAt, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={exportCustomers}
                className="bg-slate-900 hover:bg-slate-950 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Download size={18} />
                {select("تصدير CSV", "Export CSV")}
              </button>
              <button
                onClick={() => fetchData()}
                className="bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <RefreshCw size={18} />
                {select("\u062a\u062d\u062f\u064a\u062b", "Refresh")}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SummaryCard
              icon={Users}
              label={select("\u0627\u0644\u0639\u0645\u0644\u0627\u0621", "Customers")}
              value={formatNumber(summary.totalCustomers, {
                maximumFractionDigits: 0,
              })}
            />
            <SummaryCard
              icon={ShoppingCart}
              label={select("\u0627\u0644\u0637\u0644\u0628\u0627\u062a", "Orders")}
              value={formatNumber(summary.totalOrders, {
                maximumFractionDigits: 0,
              })}
            />
            <SummaryCard
              icon={ShoppingCart}
              label={select("\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0625\u0646\u0641\u0627\u0642", "Total Spent")}
              value={formatAmount(summary.totalSpent)}
            />
            <SummaryCard
              icon={User}
              label={select("\u0645\u062a\u0648\u0633\u0637 \u0627\u0644\u0625\u0646\u0641\u0627\u0642", "Avg Spend")}
              value={formatAmount(summary.avgSpent)}
            />
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">
                  {select("بحث", "Search")}
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder={select(
                      "اسم، بريد، هاتف، مدينة...",
                      "Name, email, phone, city...",
                    )}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  {select("المدينة", "City")}
                </label>
                <input
                  type="text"
                  list="customer-city-options"
                  value={cityFilter}
                  onChange={(event) => setCityFilter(event.target.value)}
                  placeholder={select(
                    "القاهرة، المعادي، مدينة نصر...",
                    "Cairo, Maadi, Nasr City...",
                  )}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <datalist id="customer-city-options">
                  {cityOptions.map((city) => (
                    <option key={city.key} value={city.label}>
                      {`${city.label} (${city.count})`}
                    </option>
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-slate-500">{cityFilterHint}</p>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  {select("الدولة", "Country")}
                </label>
                <select
                  value={countryFilter}
                  onChange={(event) => setCountryFilter(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">{select("الكل", "All")}</option>
                  {countryOptions.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table w-full min-w-[980px]">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("الاسم", "Name")}
                    </th>
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("البريد الإلكتروني", "Email")}
                    </th>
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("الهاتف", "Phone")}
                    </th>
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("الموقع", "Location")}
                    </th>
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("الطلبات", "Orders")}
                    </th>
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("إجمالي الإنفاق", "Total Spent")}
                    </th>
                    <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass}`}>
                      {select("تاريخ الانضمام", "Joined")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadStatus.active && customers.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-slate-500">
                        {select(
                          "سيظهر العملاء المحفوظون هنا تلقائيًا بمجرد جاهزية أول دفعة.",
                          "Saved customers will appear here automatically as soon as the first batch is ready.",
                        )}
                      </td>
                    </tr>
                  ) : filteredCustomers.length > 0 ? (
                    filteredCustomers.map((customer) => (
                      <tr
                        key={customer.id}
                        onClick={() => setSelectedCustomer(customer)}
                        className={`border-b hover:bg-slate-50 transition cursor-pointer ${
                          selectedCustomer?.id === customer.id ? "bg-sky-50" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">
                          {customer.name || "Unknown"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {customer.email || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {customer.phone || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {customer.city_display || customer.country ? (
                            <div className="space-y-0.5">
                              <div className="font-medium text-slate-700">
                                {customer.city_display || customer.city || "-"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {customer.country || select("بدون دولة", "No country")}
                              </div>
                              {customer.city &&
                              customer.city_display &&
                              normalizeCityText(customer.city) !==
                                normalizeCityText(customer.city_display) ? (
                                <div
                                  className="text-[11px] text-amber-600"
                                  title={customer.city}
                                >
                                  {select("الاسم الأصلي", "Original")}: {customer.city}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-800">
                          {formatNumber(customer.orders_count, {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                          {formatAmount(customer.total_spent)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {customer.created_at ? formatDate(customer.created_at) : "-"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-slate-500">
                        {select(
                          "\u0644\u0627 \u064a\u0648\u062c\u062f \u0639\u0645\u0644\u0627\u0621 \u0645\u0637\u0627\u0628\u0642\u0648\u0646.",
                          "No customers found.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedCustomerRecord && selectedCustomerMeta && (
            <div className="bg-white rounded-xl shadow p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">
                  {select(
                    "\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0639\u0645\u064a\u0644",
                    "Customer Details",
                  )}: {selectedCustomerRecord.name || select("\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641", "Unknown")}
                </h2>
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setSelectedCustomerDetails(null);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-800"
                >
                  {select("\u0625\u063a\u0644\u0627\u0642", "Close")}
                </button>
              </div>

              {selectedCustomerLoading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {select(
                    "\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0639\u0645\u064a\u0644...",
                    "Loading customer details...",
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <InfoItem
                  icon={Mail}
                  label="Email"
                  value={selectedCustomerRecord.email || "-"}
                />
                <InfoItem
                  icon={Phone}
                  label="Phone"
                  value={selectedCustomerRecord.phone || "-"}
                />
                <InfoItem
                  icon={MapPin}
                  label="Location"
                  value={
                    [
                      selectedCustomerRecord.city_display ||
                        selectedCustomerRecord.city ||
                        selectedCustomerMeta.defaultAddress?.city,
                      selectedCustomerRecord.country ||
                        selectedCustomerMeta.defaultAddress?.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "-"
                  }
                />
                <InfoItem
                  icon={ShoppingCart}
                  label="Orders / Spent"
                  value={`${formatNumber(selectedCustomerRecord.orders_count, {
                    maximumFractionDigits: 0,
                  })} / ${formatAmount(
                    selectedCustomerRecord.total_spent,
                  )}`}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Address</h3>
                  <p className="text-sm text-slate-600">
                    {selectedCustomerRecord.default_address ||
                      selectedCustomerMeta.defaultAddress?.address1 ||
                      "No address provided"}
                  </p>
                  <p className="text-sm text-slate-600">
                    {selectedCustomerMeta.defaultAddress?.zip || ""}
                  </p>
                </div>

                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Profile</h3>
                  <p className="text-sm text-slate-600">
                    Last order: {selectedCustomerMeta.lastOrderName || "-"}
                  </p>
                  <p className="text-sm text-slate-600">
                    Joined:{" "}
                    {selectedCustomerRecord.created_at
                      ? formatDate(selectedCustomerRecord.created_at)
                      : "-"}
                  </p>
                  <p className="text-sm text-slate-600">
                    Tags:{" "}
                    {selectedCustomerMeta.tags.length > 0
                      ? selectedCustomerMeta.tags.join(", ")
                      : "-"}
                  </p>
                </div>
              </div>

              {canViewOrders ? (
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3">
                    {select("\u0622\u062e\u0631 \u0627\u0644\u0637\u0644\u0628\u0627\u062a", "Recent Orders")}
                  </h3>
                  {relatedOrdersLoading ? (
                    <p className="text-sm text-slate-500">
                      {select(
                        "\u0633\u062a\u0638\u0647\u0631 \u0622\u062e\u0631 \u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0647\u0646\u0627 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627.",
                        "Recent orders will appear here automatically.",
                      )}
                    </p>
                  ) : selectedCustomerMeta.relatedOrders.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      {select(
                        "\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0637\u0644\u0628\u0627\u062a \u0645\u0631\u062a\u0628\u0637\u0629 \u062f\u0627\u062e\u0644 \u062f\u0641\u0639\u0627\u062a \u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u0645\u0633\u0648\u062d\u0629.",
                        "No related orders found in the scanned order batches.",
                      )}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table w-full min-w-[760px]">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                            <th className="py-2">Order</th>
                            <th className="py-2">Date</th>
                            <th className="py-2">Total</th>
                            <th className="py-2">Payment</th>
                            <th className="py-2">Fulfillment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCustomerMeta.relatedOrders.map((order) => (
                            <tr key={order.id} className="border-b last:border-b-0">
                              <td className="py-2 text-sm text-slate-800">
                                #{order.order_number || order.shopify_id}
                              </td>
                              <td className="py-2 text-sm text-slate-600">
                                {order.created_at ? formatDate(order.created_at) : "-"}
                              </td>
                              <td className="py-2 text-sm text-slate-700">
                                {formatAmount(order.total_price)}
                              </td>
                              <td className="py-2 text-sm text-slate-600">
                                {getOrderFinancialStatus(order) || "-"}
                              </td>
                              <td className="py-2 text-sm text-slate-600">
                                {order.fulfillment_status || "unfulfilled"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Order list is hidden because this account does not have order-view access.
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
        </div>
        <Icon size={22} className="text-sky-600" />
      </div>
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs text-slate-500 flex items-center gap-1">
        <Icon size={12} />
        {label}
      </p>
      <p className="text-sm font-medium text-slate-800 mt-1 break-words">{value}</p>
    </div>
  );
}
