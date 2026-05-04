import { useState, useEffect, useRef } from "react";
import { Package, Truck, DollarSign, TrendingUp, Trash2 } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import api from "../utils/api";
import { formatCurrency } from "../utils/helpers";
import {
  getBostaFinancialDetails,
  getFallbackOrderCost,
  parseAmount,
} from "../utils/bostaScanner";
import {
  isDemoTrackingNumber,
  normalizeTrackingNumber,
} from "../utils/bostaTracking";

const extractFetchErrorMessage = async (response) => {
  try {
    const data = await response.json();
    return data?.message || data?.error || `HTTP ${response.status}`;
  } catch {
    const text = await response.text();
    return text || `HTTP ${response.status}`;
  }
};

export default function BostaScanner() {
  const { select } = useLocale();
  const { hasPermission } = useAuth();
  const [barcode, setBarcode] = useState("");
  const [scannedItems, setScannedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const canViewOrders = hasPermission("can_view_orders");

  useEffect(() => {
    // Focus on input when page loads
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleScan = async (e) => {
    e.preventDefault();
    const trimmedBarcode = normalizeTrackingNumber(barcode);

    if (!trimmedBarcode) {
      setError(
        select("من فضلك أدخل رقم التتبع", "Please enter tracking number"),
      );
      return;
    }

    if (isDemoTrackingNumber(trimmedBarcode)) {
      setError(
        select(
          "تم إيقاف أرقام التتبع التجريبية. استخدم رقم بوسطة حقيقي.",
          "Demo tracking is disabled. Use a real Bosta tracking number.",
        ),
      );
      setBarcode(trimmedBarcode);
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Legacy demo shortcut remains intentionally unreachable while the rest
      // of the scanner now resolves against real Bosta data only.

      /*
      if (false) {
        const demoTrackingNumbers = [];
        const demoShipment = {
          tracking_number: trimmedBarcode,
          delivery_state_label: select("تم التوصيل", "Delivered"),
          expected_shipping_cost: 50,
          cod_amount: demoTrackingNumbers.includes(trimmedBarcode)
            ? 699.55
            : 500,
        };

        const newItem = {
          tracking_number: trimmedBarcode,
          order_id: null,
          order_name: select("تجريبي", "Demo"),
          customer_name: select("عميل تجريبي", "Demo Customer"),
          revenue: 0,
          total_cost: 0,
          shipping_cost: demoShipment.expected_shipping_cost,
          net_profit: 0,
          real_net_profit: -demoShipment.expected_shipping_cost,
          delivery_status: demoShipment.delivery_state_label,
          cod_amount: demoShipment.cod_amount,
          scanned_at: new Date().toISOString(),
        };

        const existingIndex = scannedItems.findIndex(
          (item) => item.tracking_number === trimmedBarcode,
        );

        if (existingIndex >= 0) {
          const updated = [...scannedItems];
          updated[existingIndex] = newItem;
          setScannedItems(updated);
        } else {
          setScannedItems([newItem, ...scannedItems]);
        }

        setBarcode("");
        setLoading(false);
        if (inputRef.current) {
          inputRef.current.focus();
        }
        return;
      }

      */
      // Get shipment details - try backend first, then Vercel function as fallback
      let shipment;
      try {
        const response = await api.get(`/bosta/shipments/${trimmedBarcode}`);
        shipment = response.data;
      } catch (apiError) {
        // Fallback to Vercel serverless function if backend fails
        console.log("Backend failed, trying Vercel function");
        try {
          const vercelResponse = await fetch(
            `/api/bosta-shipment?trackingNumber=${trimmedBarcode}`,
          );
          if (!vercelResponse.ok) {
            throw new Error(await extractFetchErrorMessage(vercelResponse));
          }
          shipment = await vercelResponse.json();
        } catch (vercelError) {
          console.error("Both backend and Vercel function failed");
          throw vercelError?.message ? vercelError : apiError;
        }
      }

      if (!shipment) {
        setError(select("الشحنة غير موجودة", "Shipment not found"));
        setLoading(false);
        return;
      }

      let order = null;
      let totalCost = parseAmount(shipment.total_cost);
      let revenue = parseAmount(shipment.revenue);
      const financialDetails = getBostaFinancialDetails(shipment);
      let shippingCost = financialDetails.shippingFee;
      let orderName = shipment.order_name || select("غير معروف", "Unknown");
      let customerName =
        shipment.customer_name || select("غير معروف", "Unknown");

      // Try to get order details if the backend did not already enrich the scan.
      if (shipment.order_id) {
        try {
          const orderResponse = await api.get(
            `/shopify/orders/${shipment.order_id}/details`,
          );
          order = orderResponse.data;

          // Calculate costs only as a fallback. The Bosta route now returns
          // enriched totals when it can match the tracking number to an order.
          const fallbackTotalCost = getFallbackOrderCost(order);

          if (revenue <= 0) {
            revenue = parseAmount(order.total_price);
          }
          if (totalCost <= 0) {
            totalCost = fallbackTotalCost;
          }
          orderName =
            shipment.order_name ||
            order.name ||
            order.order_number ||
            shipment.order_id;
          customerName =
            shipment.customer_name ||
            order.customer?.name ||
            order.customer_info?.name ||
            [order.customer_info?.first_name, order.customer_info?.last_name]
              .filter(Boolean)
              .join(" ") ||
            order.customer_name ||
            select("غير معروف", "Unknown");
        } catch (orderError) {
          console.warn("Could not fetch order details:", orderError);
          // Continue without order details
        }
      }

      // If the shipment is not linked to an internal order yet, fallback to COD
      // so the scanner still reflects a realistic collected amount.
      if (revenue <= 0) {
        revenue = financialDetails.codAmount;
      }

      const netProfit = revenue - totalCost;
      const realNetProfit = netProfit - shippingCost;

      // Check if already scanned
      const existingIndex = scannedItems.findIndex(
        (item) => item.tracking_number === trimmedBarcode,
      );

      const newItem = {
        tracking_number: trimmedBarcode,
        order_id: shipment.order_id,
        order_name: orderName,
        customer_name: customerName,
        revenue,
        total_cost: totalCost,
        shipping_cost: shippingCost,
        net_profit: netProfit,
        real_net_profit: realNetProfit,
        cod_amount: financialDetails.codAmount,
        bosta_dues: financialDetails.bostaDues,
        deposited_amount: financialDetails.depositedAmount,
        vat_amount: financialDetails.vatAmount,
        opening_package_fees: financialDetails.openingPackageFees,
        delivery_state: shipment.delivery_state,
        delivery_state_label: shipment.delivery_state_label,
        tracking_url: financialDetails.trackingUrl,
        promised_date: financialDetails.promisedDate,
        last_status_update: financialDetails.lastStatusUpdate,
        support_phone_numbers: financialDetails.supportPhoneNumbers,
        scanned_at: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        // Update existing item
        const updated = [...scannedItems];
        updated[existingIndex] = newItem;
        setScannedItems(updated);
      } else {
        // Add new item
        setScannedItems([newItem, ...scannedItems]);
      }

      setBarcode("");
      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (err) {
      console.error("Error scanning barcode:", err);
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      setError(
        errorMsg ||
          select("فشل في جلب بيانات الشحنة", "Failed to fetch shipment data"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (trackingNumber) => {
    setScannedItems(
      scannedItems.filter((item) => item.tracking_number !== trackingNumber),
    );
  };

  const handleClearAll = () => {
    if (window.confirm(select("هل تريد مسح كل البيانات؟", "Clear all data?"))) {
      setScannedItems([]);
    }
  };

  // Calculate totals
  const totals = scannedItems.reduce(
    (acc, item) => ({
      revenue: acc.revenue + item.revenue,
      cost: acc.cost + item.total_cost,
      shipping: acc.shipping + item.shipping_cost,
      bostaDues: acc.bostaDues + parseAmount(item.bosta_dues),
      cashout: acc.cashout + parseAmount(item.deposited_amount),
      netProfit: acc.netProfit + item.net_profit,
      realNetProfit: acc.realNetProfit + item.real_net_profit,
    }),
    {
      revenue: 0,
      cost: 0,
      shipping: 0,
      bostaDues: 0,
      cashout: 0,
      netProfit: 0,
      realNetProfit: 0,
    },
  );

  if (!canViewOrders) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-red-800">
                {select(
                  "ليس لديك صلاحية لعرض هذه الصفحة",
                  "You don't have permission to view this page",
                )}
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                {select("سكانر بوسطة", "Bosta Scanner")}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {select(
                  "اسكان باركود الشحنة لحساب صافي الربح الحقيقي",
                  "Scan shipment barcode to calculate real net profit",
                )}
              </p>
            </div>
            {scannedItems.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
              >
                <Trash2 size={16} />
                {select("مسح الكل", "Clear All")}
              </button>
            )}
          </div>

          {/* Scanner Input */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <form onSubmit={handleScan} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {select("رقم التتبع (Tracking Number)", "Tracking Number")}
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder={select(
                    "اسكان أو اكتب رقم التتبع",
                    "Scan or type tracking number",
                  )}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !normalizeTrackingNumber(barcode)}
                className="w-full rounded-xl bg-sky-600 px-6 py-3 font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? select("جاري المعالجة...", "Processing...")
                  : select("سكان", "Scan")}
              </button>
            </form>
          </div>

          {/* Summary Cards */}
          {scannedItems.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <SummaryCard
                icon={Package}
                label={select("عدد الشحنات", "Shipments")}
                value={scannedItems.length}
                color="blue"
              />
              <SummaryCard
                icon={DollarSign}
                label={select("الإيرادات", "Revenue")}
                value={formatCurrency(totals.revenue)}
                color="green"
              />
              <SummaryCard
                icon={TrendingUp}
                label={select("صافي الربح", "Net Profit")}
                value={formatCurrency(totals.netProfit)}
                color="purple"
              />
              <SummaryCard
                icon={Truck}
                label={select("تكلفة الشحن", "Shipping Cost")}
                value={formatCurrency(totals.shipping)}
                color="orange"
              />
              <SummaryCard
                icon={DollarSign}
                label={select("مستحقات بوسطة", "Bosta Dues")}
                value={formatCurrency(totals.bostaDues)}
                color="slate"
              />
              <SummaryCard
                icon={TrendingUp}
                label={select("الصافي المودَع", "Net Cashout")}
                value={formatCurrency(totals.cashout)}
                color="sky"
              />
              <SummaryCard
                icon={TrendingUp}
                label={select("الربح الحقيقي", "Real Net Profit")}
                value={formatCurrency(totals.realNetProfit)}
                color={totals.realNetProfit >= 0 ? "emerald" : "red"}
              />
            </div>
          )}

          {/* Scanned Items Table */}
          {scannedItems.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-left">
                        {select("رقم التتبع", "Tracking #")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-left">
                        {select("الحالة", "Status")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-left">
                        {select("الأوردر", "Order")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-left">
                        {select("العميل", "Customer")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">
                        {select("الإيرادات", "Revenue")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">
                        {select("التكلفة", "Cost")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">
                        {select("الشحن", "Shipping")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">
                        {select("صافي الربح", "Net Profit")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">
                        {select("الربح الحقيقي", "Real Profit")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700 text-center">
                        {select("إجراءات", "Actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scannedItems.map((item) => (
                      <tr
                        key={item.tracking_number}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 text-sm font-mono text-slate-900">
                          <div>{item.tracking_number}</div>
                          <div className="mt-1 text-[11px] font-normal text-slate-500">
                            {select("آخر تحديث", "Updated")}:{" "}
                            {item.last_status_update
                              ? new Date(
                                  item.last_status_update,
                                ).toLocaleString("en-GB")
                              : select("غير متاح", "Unavailable")}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              item.delivery_state === 40 ||
                              item.delivery_state === 45
                                ? "bg-green-100 text-green-800"
                                : item.delivery_state === 30 ||
                                    item.delivery_state === 41
                                  ? "bg-blue-100 text-blue-800"
                                  : item.delivery_state === 47 ||
                                      item.delivery_state === 100 ||
                                      item.delivery_state === 101
                                    ? "bg-red-100 text-red-800"
                                    : item.delivery_state === 48 ||
                                        item.delivery_state === 49 ||
                                        item.delivery_state === 50 ||
                                        item.delivery_state === 60
                                      ? "bg-gray-100 text-gray-800"
                                      : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {item.delivery_state_label ||
                              select("غير معروف", "Unknown")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900">
                          {item.order_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          <div>{item.customer_name}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            COD: {formatCurrency(item.cod_amount)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-green-700">
                          {formatCurrency(item.revenue)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-slate-600">
                          {formatCurrency(item.total_cost)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-orange-600">
                          <div>{formatCurrency(item.shipping_cost)}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {select("مستحقات بوسطة", "Bosta Dues")}:{" "}
                            {formatCurrency(item.bosta_dues)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-purple-700">
                          {formatCurrency(item.net_profit)}
                        </td>
                        <td
                          className={`px-4 py-3 text-sm text-right font-bold ${
                            item.real_net_profit >= 0
                              ? "text-emerald-700"
                              : "text-red-700"
                          }`}
                        >
                          <div>{formatCurrency(item.real_net_profit)}</div>
                          <div className="mt-1 text-[11px] font-medium text-slate-500">
                            {select("الصافي المودَع", "Net Cashout")}:{" "}
                            {formatCurrency(item.deposited_amount)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-3">
                            {item.tracking_url ? (
                              <a
                                href={
                                  item.tracking_url.startsWith("http")
                                    ? item.tracking_url
                                    : `https://${item.tracking_url}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-600 transition hover:text-sky-800"
                                title={select(
                                  "فتح تتبع بوسطة",
                                  "Open Bosta tracking",
                                )}
                              >
                                <Truck size={16} />
                              </a>
                            ) : null}
                            <button
                              onClick={() => handleDelete(item.tracking_number)}
                              className="text-red-600 hover:text-red-800 transition"
                              title={select("حذف", "Delete")}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                    <tr className="font-bold">
                      <td
                        colSpan="4"
                        className="px-4 py-3 text-sm text-slate-900"
                      >
                        {select("الإجمالي", "Total")}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-green-700">
                        {formatCurrency(totals.revenue)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-900">
                        {formatCurrency(totals.cost)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-orange-600">
                        {formatCurrency(totals.shipping)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-purple-700">
                        {formatCurrency(totals.netProfit)}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm text-right ${
                          totals.realNetProfit >= 0
                            ? "text-emerald-700"
                            : "text-red-700"
                        }`}
                      >
                        {formatCurrency(totals.realNetProfit)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {scannedItems.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
              <Truck size={48} className="mx-auto mb-4 text-slate-400" />
              <p className="text-slate-600">
                {select("لا توجد شحنات مسكانة بعد", "No shipments scanned yet")}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-3">
        <Icon size={20} />
        <div>
          <p className="text-xs font-medium opacity-80">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}
