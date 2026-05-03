import { useState, useEffect, useRef } from "react";
import { Package, Truck, DollarSign, TrendingUp, Trash2 } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import api from "../utils/api";
import { formatCurrency } from "../utils/helpers";

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

    if (!barcode.trim()) {
      setError(
        select("من فضلك أدخل رقم التتبع", "Please enter tracking number"),
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Get shipment details from Bosta
      const response = await api.get(`/bosta/shipments/${barcode.trim()}`);
      const shipment = response.data;

      if (!shipment || !shipment.order_id) {
        setError(select("الشحنة غير موجودة", "Shipment not found"));
        setLoading(false);
        return;
      }

      // Get order details to calculate net profit
      const orderResponse = await api.get(
        `/shopify/orders/${shipment.order_id}/details`,
      );
      const order = orderResponse.data;

      // Calculate costs
      const totalCost =
        order.line_items?.reduce((sum, item) => {
          const cost = parseFloat(item.cost_price || 0);
          const quantity = parseInt(item.quantity || 0);
          return sum + cost * quantity;
        }, 0) || 0;

      const shippingCost = parseFloat(shipment.expected_shipping_cost || 0);
      const revenue = parseFloat(order.total_price || 0);
      const netProfit = revenue - totalCost;
      const realNetProfit = netProfit - shippingCost;

      // Check if already scanned
      const existingIndex = scannedItems.findIndex(
        (item) => item.tracking_number === barcode.trim(),
      );

      const newItem = {
        tracking_number: barcode.trim(),
        order_id: shipment.order_id,
        order_name: order.name,
        customer_name: order.customer?.name || select("غير معروف", "Unknown"),
        revenue,
        total_cost: totalCost,
        shipping_cost: shippingCost,
        net_profit: netProfit,
        real_net_profit: realNetProfit,
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
      setError(
        err.response?.data?.error ||
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
      netProfit: acc.netProfit + item.net_profit,
      realNetProfit: acc.realNetProfit + item.real_net_profit,
    }),
    { revenue: 0, cost: 0, shipping: 0, netProfit: 0, realNetProfit: 0 },
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
                disabled={loading || !barcode.trim()}
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
                          {item.tracking_number}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900">
                          {item.order_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {item.customer_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-green-700">
                          {formatCurrency(item.revenue)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-slate-600">
                          {formatCurrency(item.total_cost)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-orange-600">
                          {formatCurrency(item.shipping_cost)}
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
                          {formatCurrency(item.real_net_profit)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleDelete(item.tracking_number)}
                            className="text-red-600 hover:text-red-800 transition"
                            title={select("حذف", "Delete")}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                    <tr className="font-bold">
                      <td
                        colSpan="3"
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
