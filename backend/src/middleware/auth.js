import jwt from "jsonwebtoken";
import { getUserRole, normalizeRole } from "./permissions.js";
import { getJwtSecret } from "../helpers/jwt.js";
import { isTransientSupabaseError } from "../helpers/supabaseRetry.js";

/**
 * Centralized JWT validation middleware
 * Extracts JWT from Authorization header, validates it, and attaches user info to req.user
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {void}
 */
export const authenticateToken = async (req, res, next) => {
  try {
    // Extract token from Authorization header (Bearer <token>)
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "No token provided",
      });
    }

    // Validate token using JWT_SECRET
    const jwtSecret = getJwtSecret();
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      // Handle different JWT errors with appropriate messages
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          error: "Token expired",
        });
      } else if (err.name === "JsonWebTokenError") {
        return res.status(401).json({
          error: "Invalid token",
        });
      }

      return res.status(401).json({
        error: "Token verification failed",
      });
    }

    // Validate required fields in decoded token
    if (!decoded.id || !decoded.email) {
      return res.status(401).json({
        error: "Invalid token payload",
      });
    }

    let normalizedRole;

    // Tests run without DB setup, so keep deterministic token-role behavior there.
    if (process.env.NODE_ENV === "test") {
      normalizedRole = normalizeRole(decoded.role || "user");
    } else {
      const tokenRole = normalizeRole(decoded.role || "user");
      const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(
        String(req.method || "").toUpperCase(),
      );
      const canFallbackToTokenRole =
        isSafeMethod &&
        String(process.env.STRICT_SAFE_GET_AUTH || "")
          .trim()
          .toLowerCase() !== "true";
      const roleRetryOptions = isSafeMethod
        ? { attempts: 1, timeoutMs: 2500 }
        : { attempts: 2, baseDelayMs: 150, timeoutMs: 5000 };

      try {
        // Always resolve current role from DB to avoid stale JWT role privileges.
        const dbRole = await getUserRole(decoded.id, {
          retryOptions: roleRetryOptions,
        });
        if (!dbRole) {
          return res.status(401).json({
            error: "User not found",
          });
        }

        normalizedRole = normalizeRole(dbRole);
      } catch (roleError) {
        if (canFallbackToTokenRole && isTransientSupabaseError(roleError)) {
          normalizedRole = tokenRole;
          req.authFallback = {
            source: "token-role",
          };
        } else {
          throw roleError;
        }
      }
    }

    // Attach decoded user object to req.user with required fields
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: normalizedRole,
    };

    // Set convenience flag for admin role
    req.user.isAdmin = normalizedRole === "admin";

    next();
  } catch (error) {
    console.error("Authentication middleware error:", error);
    return res.status(isTransientSupabaseError(error) ? 503 : 500).json({
      error: isTransientSupabaseError(error)
        ? "Authentication service is temporarily unavailable"
        : "Authentication failed",
    });
  }
};
