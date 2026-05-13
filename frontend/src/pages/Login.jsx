import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Boxes,
  BarChart3,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { authAPI, getErrorMessage } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import LanguageToggle from "../components/LanguageToggle";

export default function Login() {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();
  const { isRTL, select, t } = useLocale();

  const highlights = useMemo(
    () => [
      {
        icon: BarChart3,
        title: select("لوحة متابعة واضحة", "Clear daily control"),
        description: select(
          "تابع الطلبات والمبيعات والربح من نفس المكان بشكل مرتب.",
          "Track orders, revenue, and profit in one clean workspace.",
        ),
      },
      {
        icon: Boxes,
        title: select("تشغيل منظم", "Organized operations"),
        description: select(
          "إدارة المنتجات والمخزون والعملاء بدون لخبطة بين الصفحات.",
          "Manage products, inventory, and customers without noisy screens.",
        ),
      },
      {
        icon: ShieldCheck,
        title: select("صلاحيات مضبوطة", "Controlled access"),
        description: select(
          "كل مستخدم يشوف اللي يخصه فقط بصلاحيات واضحة وقابلة للمراجعة.",
          "Give each teammate only the access they need with clear permissions.",
        ),
      },
    ],
    [select],
  );

  const iconPositionClass = isRTL ? "right-4" : "left-4";
  const inputPaddingClass = isRTL ? "pr-12 pl-4" : "pl-12 pr-4";
  const togglePositionClass = isRTL ? "left-4" : "right-4";

  const handleChange = (event) => {
    setFormData({
      ...formData,
      [event.target.name]: event.target.value,
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      localStorage.removeItem("currentStoreId");
      const response = await authAPI.login(formData);
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));

      if (response.data.permissions) {
        localStorage.setItem(
          "permissions",
          JSON.stringify(response.data.permissions),
        );
      }

      await refreshAuth();
      navigate("/dashboard");
    } catch (requestError) {
      console.error("Login error:", requestError);
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.16),_transparent_30%),linear-gradient(180deg,#dfeaf5_0%,#edf4fa_42%,#e8f0f7_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className={`fixed top-4 ${togglePositionClass} z-20`}>
        <LanguageToggle />
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="app-surface-strong hidden rounded-[34px] p-8 lg:flex lg:flex-col lg:justify-between xl:p-10">
            <div>
              <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
                <ShieldCheck size={14} />
                {select("تجربة تشغيل أكثر هدوءًا", "A calmer operating experience")}
              </div>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/80 bg-sky-50 text-sky-700 shadow-lg shadow-sky-100/80">
                  <ShieldCheck size={26} />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                    {t("auth.appName", "Moon Profit")}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {select(
                      "منصة إدارة المتجر اليومية",
                      "Your daily store operations workspace",
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-10 space-y-4">
                <h2 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.05em] text-slate-950">
                  {select(
                    "ادخل على شغلك من شاشة مرتبة وواضحة بدل الزحمة البصرية.",
                    "Start from a cleaner, clearer control surface for the whole store.",
                  )}
                </h2>
                <p className="max-w-xl text-sm leading-7 text-slate-600">
                  {select(
                    "جرى توحيد الواجهة والبيانات والأرقام عشان الحركة بين الصفحات تبقى أسرع والفهم أبسط.",
                    "The interface, data views, and number formatting are aligned so navigation feels faster and easier to read.",
                  )}
                </p>
              </div>
            </div>

            <div className="mt-10 grid gap-3">
              {highlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="app-note flex items-start gap-4 px-4 py-4"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {item.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="app-surface-strong rounded-[34px] p-6 sm:p-8 xl:p-10">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-8 text-center lg:text-left">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/80 bg-sky-50 text-sky-700 shadow-lg shadow-sky-100/80 lg:mx-0">
                  <Lock size={24} />
                </div>
                <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {t("auth.signIn", "Sign in")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {t("auth.loginSubtitle", "Sign in to your Moon Profit account")}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    {t("auth.email", "Email")}
                  </label>
                  <div className="relative">
                    <Mail
                      className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${iconPositionClass}`}
                      size={18}
                    />
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      autoComplete="username"
                      placeholder="example@email.com"
                      className={`app-input ${inputPaddingClass} py-3 text-sm`}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    {t("auth.password", "Password")}
                  </label>
                  <div className="relative">
                    <Lock
                      className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${iconPositionClass}`}
                      size={18}
                    />
                    <input
                      type="password"
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      autoComplete="current-password"
                      placeholder="........"
                      className={`app-input ${inputPaddingClass} py-3 text-sm`}
                      required
                    />
                  </div>
                </div>

                {error ? (
                  <div className="rounded-[22px] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="app-button-primary flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? t("auth.signingIn", "Signing in...")
                    : t("auth.signIn", "Sign in")}
                </button>
              </form>

              <div className="app-note mt-5 px-4 py-3 text-xs leading-6 text-slate-500">
                {select(
                  "التسجيل الذاتي يظل متاحًا فقط أثناء الإعداد الأولي أو إذا قامت الإدارة بتفعيله.",
                  "Self-registration stays available only during initial setup or when the admin enables it.",
                )}
              </div>

              <p className="mt-6 text-center text-sm text-slate-600 lg:text-left">
                {t("auth.noAccount", "Don't have an account?")}{" "}
                <Link
                  to="/register"
                  className="font-semibold text-sky-700 transition hover:text-sky-800"
                >
                  {t("auth.createAccount", "Create one")}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
