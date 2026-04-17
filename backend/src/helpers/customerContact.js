const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const getNormalizedPhone = (value) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};

const getAddressPhone = (address) => getNormalizedPhone(address?.phone);

const getAddressesPhone = (addresses = []) => {
  for (const address of Array.isArray(addresses) ? addresses : []) {
    const phone = getAddressPhone(address);
    if (phone) {
      return phone;
    }
  }

  return "";
};

export const extractCustomerPhone = (customer = {}) => {
  const parsedData = parseJsonObject(customer?.data);

  return (
    getNormalizedPhone(customer?.phone) ||
    getNormalizedPhone(parsedData?.phone) ||
    getAddressPhone(customer?.default_address) ||
    getAddressPhone(parsedData?.default_address) ||
    getAddressesPhone(customer?.addresses) ||
    getAddressesPhone(parsedData?.addresses) ||
    ""
  );
};

export const normalizeCustomerContact = (customer = {}) => ({
  ...customer,
  phone: extractCustomerPhone(customer),
});
