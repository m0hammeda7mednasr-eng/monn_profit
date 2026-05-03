/**
 * Bosta Shipping Component
 * Handles Bosta shipping integration for orders
 */

import React, { useState, useEffect } from "react";
import {
  hasBostaTracking,
  getBostaTrackingInfo,
  isEligibleForBostaShipping,
  getBostaStateLabel,
  getBostaStateBadgeClass,
  suggestPackageType,
  calculateCODAmount,
  generateOrderDescription,
  shipOrderWithBosta,
  fetchDeliveryStatus,
  cancelDelivery,
  BOSTA_PACKAGE_TYPES,
} from "../utils/bostaApi";

const BostaShipping = ({ order, onOrderUpdate, language = "ar" }) => {
  const [isShipping, setIsShipping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingInfo, setTrackingInfo] = useState(null);
  const [shippingOptions, setShippingOptions] = useState({
    packageType: suggestPackageType(order),
    allowOpenPackage: false,
    flexShip: false,
    businessLocationId: "",
  });

  const isRTL = language === "ar";
  const eligible = isEligibleForBostaShipping(order);
  const hasTracking = hasBostaTracking(order);

  useEffect(() => {
    if (hasTracking) {
      setTrackingInfo(getBostaTrackingInfo(order));
    }
  }, [order, hasTracking]);

  const handleShipOrder = async () => {
    if (!eligible || isShipping) return;

    setIsShipping(true);
    setError(null);

    try {
      const result = await shipOrderWithBosta(order.id, shippingOptions);

      // Update order with tracking info
      if (onOrderUpdate) {
        onOrderUpdate({
          ...order,
          data: {
            ...order.data,
            bosta_tracking_number: result.trackingNumber,
            bosta_delivery_id: result.delivery._id,
            bosta_status: "shipped",
            bosta_shipped_at: new Date().toISOString(),
          },
        });
      }

      setTrackingInfo({
        trackingNumber: result.trackingNumber,
        deliveryId: result.delivery._id,
        status: "shipped",
        shippedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsShipping(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!trackingInfo?.trackingNumber) return;

    setIsLoading(true);
    setError(null);

    try {
      const status = await fetchDeliveryStatus(trackingInfo.trackingNumber);

      // Update tracking info
      setTrackingInfo((prev) => ({
        ...prev,
        status: status.state,
        lastUpdate: new Date().toISOString(),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelDelivery = async () => {
    if (!trackingInfo?.trackingNumber) return;

    const confirmed = window.confirm(
      isRTL
        ? "هل أنت متأكد من إلغاء الشحنة؟"
        : "Are you sure you want to cancel the delivery?",
    );

    if (!confirmed) return;

    setIsLoading(true);
    setError(null);

    try {
      await cancelDelivery(trackingInfo.trackingNumber, "Manual cancellation");

      // Update tracking info
      setTrackingInfo((prev) => ({
        ...prev,
        status: 50, // CANCELLED
        lastUpdate: new Date().toISOString(),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!eligible && !hasTracking) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-600">
          {isRTL
            ? "هذا الطلب غير مؤهل للشحن مع بوسطة"
            : "This order is not eligible for Bosta shipping"}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          {isRTL ? "شحن بوسطة" : "Bosta Shipping"}
        </h3>

        {hasTracking && (
          <div className="flex items-center space-x-2 rtl:space-x-reverse">
            <button
              onClick={handleRefreshStatus}
              disabled={isLoading}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              {isLoading
                ? isRTL
                  ? "جاري التحديث..."
                  : "Refreshing..."
                : isRTL
                  ? "تحديث الحالة"
                  : "Refresh Status"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {hasTracking ? (
        <div className="space-y-3">
          {/* Tracking Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isRTL ? "رقم التتبع" : "Tracking Number"}
              </label>
              <p className="text-sm text-gray-900 font-mono">
                {trackingInfo.trackingNumber}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isRTL ? "حالة الشحنة" : "Delivery Status"}
              </label>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getBostaStateBadgeClass(trackingInfo.status)}`}
              >
                {getBostaStateLabel(trackingInfo.status, language)}
              </span>
            </div>
          </div>

          {trackingInfo.lastUpdate && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isRTL ? "آخر تحديث" : "Last Update"}
              </label>
              <p className="text-sm text-gray-600">
                {new Date(trackingInfo.lastUpdate).toLocaleString(
                  isRTL ? "ar-EG" : "en-US",
                )}
              </p>
            </div>
          )}

          {trackingInfo.deliveryAttempts > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isRTL ? "محاولات التوصيل" : "Delivery Attempts"}
              </label>
              <p className="text-sm text-gray-600">
                {trackingInfo.deliveryAttempts}
              </p>
            </div>
          )}

          {trackingInfo.exceptionReason && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isRTL ? "سبب المشكلة" : "Exception Reason"}
              </label>
              <p className="text-sm text-red-600">
                {trackingInfo.exceptionReason}
              </p>
            </div>
          )}

          {trackingInfo.codCollected && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isRTL ? "المبلغ المحصل" : "COD Collected"}
              </label>
              <p className="text-sm text-green-600 font-semibold">
                {trackingInfo.codCollected} {isRTL ? "جنيه" : "EGP"}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-2 rtl:space-x-reverse">
            {trackingInfo.trackingNumber && (
              <a
                href={`https://bosta.co/tracking-shipments/${trackingInfo.trackingNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                {isRTL ? "تتبع الشحنة" : "Track Shipment"}
              </a>
            )}

            {trackingInfo.status !== 50 && trackingInfo.status !== 40 && (
              <button
                onClick={handleCancelDelivery}
                disabled={isLoading}
                className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm leading-4 font-medium rounded-md text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
              >
                {isRTL ? "إلغاء الشحنة" : "Cancel Delivery"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Shipping Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isRTL ? "نوع الطرد" : "Package Type"}
              </label>
              <select
                value={shippingOptions.packageType}
                onChange={(e) =>
                  setShippingOptions((prev) => ({
                    ...prev,
                    packageType: e.target.value,
                  }))
                }
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                {Object.entries(BOSTA_PACKAGE_TYPES).map(([key, value]) => (
                  <option key={key} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isRTL ? "معرف الموقع" : "Business Location ID"}
              </label>
              <input
                type="text"
                value={shippingOptions.businessLocationId}
                onChange={(e) =>
                  setShippingOptions((prev) => ({
                    ...prev,
                    businessLocationId: e.target.value,
                  }))
                }
                placeholder={isRTL ? "اختياري" : "Optional"}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={shippingOptions.allowOpenPackage}
                onChange={(e) =>
                  setShippingOptions((prev) => ({
                    ...prev,
                    allowOpenPackage: e.target.checked,
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 rtl:ml-0 rtl:mr-2 text-sm text-gray-700">
                {isRTL ? "السماح بفتح الطرد" : "Allow Open Package"}
              </span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={shippingOptions.flexShip}
                onChange={(e) =>
                  setShippingOptions((prev) => ({
                    ...prev,
                    flexShip: e.target.checked,
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 rtl:ml-0 rtl:mr-2 text-sm text-gray-700">
                {isRTL ? "تفعيل FlexShip" : "Enable FlexShip"}
              </span>
            </label>
          </div>

          {/* Order Summary */}
          <div className="bg-gray-50 rounded-md p-3">
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              {isRTL ? "ملخص الطلب" : "Order Summary"}
            </h4>
            <div className="space-y-1 text-sm text-gray-600">
              <p>
                <span className="font-medium">
                  {isRTL ? "الوصف:" : "Description:"}
                </span>{" "}
                {generateOrderDescription(order)}
              </p>
              <p>
                <span className="font-medium">
                  {isRTL ? "المبلغ المطلوب تحصيله:" : "COD Amount:"}
                </span>{" "}
                {calculateCODAmount(order)} {isRTL ? "جنيه" : "EGP"}
              </p>
            </div>
          </div>

          {/* Ship Button */}
          <button
            onClick={handleShipOrder}
            disabled={isShipping}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isShipping
              ? isRTL
                ? "جاري الشحن..."
                : "Shipping..."
              : isRTL
                ? "شحن مع بوسطة"
                : "Ship with Bosta"}
          </button>
        </div>
      )}
    </div>
  );
};

export default BostaShipping;
