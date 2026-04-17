import {
  formatCurrency as formatCurrencyValue,
  formatDateTime as formatDateTimeValue,
  formatNumber as formatNumberValue,
  formatPercent as formatPercentValue,
  formatTime as formatTimeValue,
  getCurrencyLabel,
} from "./localeFormat";

// Auth utilities
export const getToken = () => localStorage.getItem("token");

export const saveToken = (token) => localStorage.setItem("token", token);

export const removeToken = () => localStorage.removeItem("token");

export const isAuthenticated = () => {
  return !!getToken();
};

// Format utilities
export const CURRENCY_LABEL = getCurrencyLabel();

export const formatNumber = (value, options = {}) =>
  formatNumberValue(value, options);

export const formatCurrency = (amount, options = {}) =>
  formatCurrencyValue(amount, options);

export const formatPercent = (value, options = {}) =>
  formatPercentValue(value, options);

export const formatDate = (date) =>
  formatDateTimeValue(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatDateTime = (date, options = {}) =>
  formatDateTimeValue(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...options,
  });

export const formatTime = (date, options = {}) =>
  formatTimeValue(date, options);

// Validation utilities
export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validatePassword = (password) => {
  return password.length >= 8;
};

// Array utilities
export const paginate = (array, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  return array.slice(offset, offset + limit);
};

export const getTotalPages = (total, limit = 20) => {
  return Math.ceil(total / limit);
};
