import express from "express";
import jwt from "jsonwebtoken";
import bcryptjs from "bcryptjs";
import { supabase } from "../supabaseClient.js";
import {
  buildPermissionsForRole,
  getUserPermissions,
  normalizeRole,
  primeUserAccessContext,
} from "../middleware/permissions.js";
import { getJwtSecret } from "../helpers/jwt.js";
import {
  isTransientSupabaseError,
  withSupabaseRetry,
} from "../helpers/supabaseRetry.js";

const router = express.Router();
const INVALID_LOGIN_ERROR = "Invalid email or password";
const AUTH_SERVICE_UNAVAILABLE_ERROR =
  "Authentication service is temporarily unavailable. Please try again in a moment.";
const SELF_REGISTRATION_DISABLED_ERROR =
  "Self-service registration is disabled. Ask an admin to create your account.";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const resolveRegistrationPolicy = async () => {
  const allowSelfRegistration =
    String(process.env.ALLOW_SELF_REGISTRATION || "").trim().toLowerCase() ===
    "true";

  if (allowSelfRegistration) {
    return {
      allowed: true,
      bootstrapAdmin: false,
    };
  }

  const { data, error } = await withSupabaseRetry(() =>
    supabase.from("users").select("id").limit(1),
  );

  if (error) {
    throw error;
  }

  const hasExistingUsers = Array.isArray(data) && data.length > 0;
  return {
    allowed: !hasExistingUsers,
    bootstrapAdmin: !hasExistingUsers,
  };
};

const createTokenPayload = (user) => ({
  id: user.id,
  email: user.email,
  role: normalizeRole(user.role || "user"),
});

const signUserToken = (user) =>
  jwt.sign(createTokenPayload(user), getJwtSecret(), { expiresIn: "7d" });

// Register
router.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();

    if (!email || !password || !name) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters long" });
    }

    const registrationPolicy = await resolveRegistrationPolicy();
    if (!registrationPolicy.allowed) {
      return res.status(403).json({ error: SELF_REGISTRATION_DISABLED_ERROR });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);
    const { data: userData, error: userError } = await withSupabaseRetry(() =>
      supabase
        .from("users")
        .insert([
          {
            email,
            password: hashedPassword,
            name,
            role: registrationPolicy.bootstrapAdmin ? "admin" : "user",
            is_active: true,
          },
        ])
        .select("id, email, name, role"),
    );

    if (userError) {
      if (isTransientSupabaseError(userError)) {
        return res.status(503).json({ error: AUTH_SERVICE_UNAVAILABLE_ERROR });
      }

      if (userError.code === "23505") {
        return res.status(400).json({ error: "Email is already in use" });
      }

      return res.status(400).json({ error: userError.message });
    }

    const user = Array.isArray(userData) ? userData[0] : null;
    if (!user) {
      return res.status(500).json({ error: "Failed to create account" });
    }

    const normalizedRole = normalizeRole(user.role || "user");
    const permissions = buildPermissionsForRole(normalizedRole);
    primeUserAccessContext(user.id, {
      role: normalizedRole,
      permissions,
    });

    res.json({
      token: signUserToken(user),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
      },
      permissions,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(isTransientSupabaseError(error) ? 503 : 500).json({
      error: isTransientSupabaseError(error)
        ? AUTH_SERVICE_UNAVAILABLE_ERROR
        : "An error occurred while creating the account",
    });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required" });
    }

    const { data: user, error } = await withSupabaseRetry(() =>
      supabase
        .from("users")
        .select("id, email, name, password, role")
        .ilike("email", email)
        .limit(1)
        .maybeSingle(),
    );

    if (error) {
      console.error("Login user lookup error:", error);
      return res.status(isTransientSupabaseError(error) ? 503 : 500).json({
        error: isTransientSupabaseError(error)
          ? AUTH_SERVICE_UNAVAILABLE_ERROR
          : "Failed to validate login credentials",
      });
    }

    if (!user) {
      return res.status(401).json({ error: INVALID_LOGIN_ERROR });
    }

    const passwordMatch = await bcryptjs.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: INVALID_LOGIN_ERROR });
    }

    const normalizedRole = normalizeRole(user.role || "user");
    const permissions = buildPermissionsForRole(
      normalizedRole,
      normalizedRole === "admin"
        ? null
        : await getUserPermissions(user.id, { useCache: false }),
    );
    primeUserAccessContext(user.id, {
      role: normalizedRole,
      permissions,
    });

    res.json({
      token: signUserToken(user),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
      },
      permissions,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(isTransientSupabaseError(error) ? 503 : 500).json({
      error: isTransientSupabaseError(error)
        ? AUTH_SERVICE_UNAVAILABLE_ERROR
        : "An error occurred while signing in",
    });
  }
});

// Verify Token
router.post("/verify", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

export default router;
