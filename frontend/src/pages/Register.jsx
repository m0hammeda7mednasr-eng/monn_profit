import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { useLocale } from "../context/LocaleContext";
import LanguageToggle from "../components/LanguageToggle";
import { authAPI, getErrorMessage } from "../utils/api";

export default function Register() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { isRTL, select, t } = useLocale();

  const guidance = useMemo(
    () => [
      select("استخدم بريد شغال عشان استلام الصلاحيات والتنبيهات.", "Use a working email for access and alerts."),
      select("ابدأ بحساب مدير واحد فقط ثم وزع الصلاحيات من الداخل.", "Start with one admin account, then assign permissions inside the app."),
      select("كلمة المرور لازم تبقى 6 حروف على الأقل.", "Your password must be at least 6 characters."),
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
      if (formData.password !== formData.confirmPassword) {
        setError(t("auth.passwordMismatch", "Passwords do not match"));
        setLoading(false);
        return;
      }

      if (formData.password.length < 6) {
        setError(
          t(
            "auth.passwordTooShort",
            "Password must be at least 6 characters",
          ),
        );
        setLoading(false);
        return;
      }

      const response = await authAPI.register({
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      localStorage.setItem(
        "permissions",
        JSON.stringify(response.data.permissions || {}),
      );
      navigate("/dashboard");
    } catch (requestError) {
      console.error("Registration error:", requestError);
      setError(
        getErrorMessage(requestError) ||
          t(
            "auth.registerFailed",
            "Failed to create account. Please try again.",
          ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.16),_transparent_28%),linear-gradient(180deg,#e8f4ef_0%,#eef5fa_44%,#e8f0f6_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className={`fixed top-4 ${togglePositionClass} z-20`}>
        <LanguageToggle />
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center">
        <div className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
          <section className="app-surface-strong hidden rounded-[34px] p-8 lg:flex lg:flex-col lg:justify-between xl:p-10">
            <div>
              <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
                <Users size={14} />
                {select("إعداد الحساب الأول", "First account setup")}
              </div>

              <div className="mt-8 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/80 bg-emerald-50 text-emerald-700 shadow-lg shadow-emerald-100/70">
                  <ShieldCheck size={26} />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                    {t("auth.appName", "Moon Profit")}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {select("بداية نظيفة للنظام", "A clean start for the system")}
                  </p>
                </div>
              </div>

              <div className="mt-10 space-y-4">
                <h2 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.05em] text-slate-950">
                  {select(
                    "ابنِ حساب البداية بشكل واضح ثم وزع الصلاحيات بهدوء من الداخل.",
                    "Set up the first account cleanly, then manage permissions from inside.",
                  )}
                </h2>
                <p className="max-w-xl text-sm leading-7 text-slate-600">
                  {select(
                    "الشاشة دي بقت بنفس الشكل الاحترافي لباقي النظام، مع خطوات أوضح وحقول أسهل في القراءة.",
                    "This screen now matches the rest of the product with clearer guidance and easier-to-scan inputs.",
                  )}
                </p>
              </div>
            </div>

            <div className="mt-10 space-y-3">
              {guidance.map((item) => (
                <div
                  key={item}
                  className="app-note flex items-start gap-3 px-4 py-4"
                >
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                    <CheckCircle2 size={16} />
                  </div>
                  <p className="text-sm leading-6 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="app-surface-strong rounded-[34px] p-6 sm:p-8 xl:p-10">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-8 text-center lg:text-left">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/80 bg-emerald-50 text-emerald-700 shadow-lg shadow-emerald-100/70 lg:mx-0">
                  <User size={24} />
                </div>
                <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {t("auth.registerTitle", "Create a New Account")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {t("auth.registerSubtitle", "Join the store management system")}
                </p>
              </div>

              <div className="mb-5 rounded-[22px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm leading-6 text-amber-800">
                {select(
                  "التسجيل الذاتي متاح فقط لإنشاء أول حساب في النظام أو إذا قامت الإدارة بتفعيله.",
                  "Self-registration is available only for the first system account or when enabled by an admin.",
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field
                  icon={User}
                  iconPositionClass={iconPositionClass}
                  inputPaddingClass={inputPaddingClass}
                  label={t("auth.fullName", "Full name")}
                >
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    autoComplete="name"
                    placeholder={t("auth.fullNamePlaceholder", "Enter your name")}
                    className={`app-input ${inputPaddingClass} py-3 text-sm`}
                    required
                  />
                </Field>

                <Field
                  icon={Mail}
                  iconPositionClass={iconPositionClass}
                  inputPaddingClass={inputPaddingClass}
                  label={t("auth.email", "Email")}
                >
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
                </Field>

                <Field
                  icon={Lock}
                  iconPositionClass={iconPositionClass}
                  inputPaddingClass={inputPaddingClass}
                  label={t("auth.password", "Password")}
                >
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    autoComplete="new-password"
                    placeholder="........"
                    className={`app-input ${inputPaddingClass} py-3 text-sm`}
                    required
                  />
                </Field>

                <Field
                  icon={ShieldCheck}
                  iconPositionClass={iconPositionClass}
                  inputPaddingClass={inputPaddingClass}
                  label={t("auth.confirmPassword", "Confirm password")}
                >
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    autoComplete="new-password"
                    placeholder="........"
                    className={`app-input ${inputPaddingClass} py-3 text-sm`}
                    required
                  />
                </Field>

                {error && (
                  <div className="rounded-[22px] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="app-button-primary flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? t("auth.creatingAccount", "Creating account...")
                    : t("auth.createAccountButton", "Create Account")}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-600 lg:text-left">
                {t("auth.haveAccount", "Already have an account?")}{" "}
                <Link
                  to="/login"
                  className="font-semibold text-sky-700 transition hover:text-sky-800"
                >
                  {t("auth.login", "Sign in")}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({
  children,
  icon: Icon,
  iconPositionClass,
  label,
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <Icon
          className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${iconPositionClass}`}
          size={18}
        />
        {children}
      </div>
    </div>
  );
}
