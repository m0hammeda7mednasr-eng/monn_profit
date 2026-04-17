import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";

export default function ProtectedRoute({ children, permission }) {
  const { user, loading, hasPermission } = useAuth();
  const { select } = useLocale();

  if (loading) {
    return <div>{select("\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644...", "Loading...")}</div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  // If a permission is required, check for it.
  // If no permission prop is passed, just being logged in is enough.
  if (permission && !hasPermission(permission)) {
    // Redirect to dashboard if user doesn't have permission
    return <Navigate to="/dashboard" />;
  }

  return children;
}
