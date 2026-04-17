import express from "express";
import jwt from "jsonwebtoken";
import { getUserRole, normalizeRole } from "../middleware/permissions.js";
import { registerRealtimeClient } from "../services/realtimeEventService.js";
import { getJwtSecret } from "../helpers/jwt.js";

const router = express.Router();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return token;
    }
  }

  const queryToken =
    typeof req.query?.token === "string" ? req.query.token.trim() : "";
  return queryToken || null;
};

const getRequestedStoreId = (req) => {
  const fromQuery =
    typeof req.query?.store_id === "string" ? req.query.store_id.trim() : "";
  const fromHeader =
    typeof req.headers["x-store-id"] === "string"
      ? req.headers["x-store-id"].trim()
      : "";
  const candidate = fromQuery || fromHeader;
  if (!candidate || !UUID_REGEX.test(candidate)) {
    return null;
  }
  return candidate;
};

const resolveAuthenticatedUser = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }

  if (!decoded?.id || !decoded?.email) {
    return null;
  }

  let role = normalizeRole(decoded.role || "user");
  if (process.env.NODE_ENV !== "test") {
    const dbRole = await getUserRole(decoded.id);
    if (!dbRole) {
      return null;
    }
    role = normalizeRole(dbRole);
  }

  return {
    id: decoded.id,
    email: decoded.email,
    role,
    isAdmin: role === "admin",
  };
};

router.get("/stream", async (req, res) => {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const requestedStoreId = getRequestedStoreId(req);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const unsubscribe = registerRealtimeClient({
      res,
      userId: user.id,
      storeId: requestedStoreId,
    });

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        connected: true,
        at: new Date().toISOString(),
      })}\n\n`,
    );

    const cleanup = () => {
      unsubscribe();
      try {
        res.end();
      } catch {
        // ignore close errors
      }
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
    return undefined;
  } catch (error) {
    console.error("Realtime stream error:", error);
    return res.status(500).json({ error: "Failed to initialize realtime stream" });
  }
});

export default router;
