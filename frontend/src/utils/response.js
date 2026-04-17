const ARRAY_KEYS = [
  "data",
  "items",
  "rows",
  "results",
  "records",
  "list",
  "users",
  "tasks",
  "reports",
  "requests",
  "orders",
  "products",
  "customers",
  "logs",
];

export const extractArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of ARRAY_KEYS) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  if (payload.data && typeof payload.data === "object") {
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(payload.data[key])) {
        return payload.data[key];
      }
    }
  }

  const firstArrayValue = Object.values(payload).find((value) =>
    Array.isArray(value),
  );
  return Array.isArray(firstArrayValue) ? firstArrayValue : [];
};

export const extractObject = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  if (
    payload.data &&
    typeof payload.data === "object" &&
    !Array.isArray(payload.data)
  ) {
    return payload.data;
  }

  return payload;
};
