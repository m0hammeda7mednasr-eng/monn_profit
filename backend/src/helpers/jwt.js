let hasWarnedAboutJwtFallback = false;

export const getJwtSecret = () => {
  const configuredSecret = String(process.env.JWT_SECRET || "").trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "test") {
    return "test-secret-key";
  }

  const fallbackSecret = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();
  if (fallbackSecret) {
    if (!hasWarnedAboutJwtFallback) {
      console.warn(
        "JWT_SECRET is not set. Falling back to SUPABASE_SERVICE_ROLE_KEY for application JWT signing. Configure JWT_SECRET explicitly in production.",
      );
      hasWarnedAboutJwtFallback = true;
    }

    return fallbackSecret;
  }

  throw new Error(
    "JWT_SECRET is not configured. Set JWT_SECRET explicitly or provide SUPABASE_SERVICE_ROLE_KEY as a temporary fallback.",
  );
};

export const __resetJwtHelperStateForTests = () => {
  hasWarnedAboutJwtFallback = false;
};
