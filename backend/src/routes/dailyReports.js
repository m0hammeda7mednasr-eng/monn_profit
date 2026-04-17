import express from "express";
import multer from "multer";
import { supabase } from "../supabaseClient.js";
import fileUploadService from "../services/fileUploadService.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";

const router = express.Router();
const DAILY_REPORTS_BUCKET = "daily-reports-attachments";
const MAX_REPORT_FILE_SIZE = 10 * 1024 * 1024;

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_REPORT_FILE_SIZE, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, PDFs, Excel, Word documents
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "نوع الملف غير مدعوم. يرجى رفع صور أو ملفات PDF أو Excel أو Word فقط",
        ),
      );
    }
  },
});

const collectUploadedFiles = (req) => {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  if (req.files && typeof req.files === "object") {
    return [...(req.files.files || []), ...(req.files["files[]"] || [])];
  }

  return [];
};

const MIN_ANALYTICS_DAYS = 7;
const MAX_ANALYTICS_DAYS = 180;
const MAX_REPORTS_LIST_LIMIT = 100;

const parseDaysParam = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(MAX_ANALYTICS_DAYS, Math.max(MIN_ANALYTICS_DAYS, parsed));
};

const parseListLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(MAX_REPORTS_LIST_LIMIT, parsed);
};

const parseListOffset = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
};

const shouldIncludeCount = (value) =>
  ["1", "true", "yes"].includes(String(value || "").toLowerCase());

const toDayKey = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const getDateRange = (days) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  return { start, end };
};

const buildDateKeys = (startDate, endDate) => {
  const keys = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
};

const estimateTasksCount = (text) => {
  if (!text || typeof text !== "string") return 0;

  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[;,]+/g, "\n")
    .replace(/[\u2022\u00B7\-]+/g, "\n");

  return normalized
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
};

const normalizeAttachment = (item) => {
  if (!item) return null;

  const normalized = {
    fileName: item.fileName || item.file_name || item.name || "attachment",
    url: item.url || item.file_url || null,
    storagePath: item.storagePath || item.storage_path || null,
    size: Number(item.size ?? item.size_bytes ?? 0) || 0,
    mimeType: item.mimeType || item.mime_type || item.type || "",
  };

  if (!normalized.url) {
    return null;
  }

  return normalized;
};

const normalizeAttachmentsArray = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((item) => normalizeAttachment(item))
    .filter(Boolean);
};

const uploadReportFiles = async (files, userId) => {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const fileUploads = files.map((file) => ({
    buffer: file.buffer,
    name: file.originalname,
    mimeType: file.mimetype,
  }));

  await fileUploadService.ensureBucket(DAILY_REPORTS_BUCKET, {
    public: true,
    fileSizeLimit: MAX_REPORT_FILE_SIZE,
  });

  return await fileUploadService.uploadMultipleFiles(fileUploads, userId, {
    bucketName: DAILY_REPORTS_BUCKET,
    prefix: "reports",
  });
};

const getDisciplineLevel = (score) => {
  if (score >= 85) return "high";
  if (score >= 65) return "good";
  if (score >= 45) return "average";
  return "needs_attention";
};

// Get my reports
router.get("/my-reports", authenticateToken, async (req, res) => {
  try {
    let query = supabase
      .from("daily_reports")
      .select("*")
      .eq("user_id", req.user.id)
      .order("report_date", { ascending: false })
      .limit(100);

    const { data, error } = await query;

    if (error) throw error;

    const normalizedReports = (data || []).map((report) => ({
      ...report,
      attachments: normalizeAttachmentsArray(report.attachments),
    }));

    res.json(normalizedReports);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// Get all reports (Admin only)
router.get(
  "/all",
  authenticateToken,
  requirePermission("can_view_all_reports"),
  async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);
    const offset = parseListOffset(req.query.offset);
    const includeCount = shouldIncludeCount(req.query.include_count);

    let query = supabase
      .from("daily_reports")
      .select(
        `
        *,
        users!daily_reports_user_id_fkey (name, email)
      `,
        includeCount ? { count: "exact" } : undefined,
      )
      .order("report_date", { ascending: false });

    if (limit !== null) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const normalizedReports = (data || []).map((report) => ({
      ...report,
      attachments: normalizeAttachmentsArray(report.attachments),
    }));

    if (includeCount) {
      return res.json({
        data: normalizedReports,
        total: Number.isFinite(count) ? count : normalizedReports.length,
        limit,
        offset,
      });
    }

    res.json(normalizedReports);
  } catch (error) {
    console.error("Error fetching all reports:", error);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
  },
);

// Employee analytics with flow chart data (Admin/authorized users)
router.get(
  "/analytics",
  authenticateToken,
  requirePermission("can_view_all_reports"),
  async (req, res) => {
    try {
      const days = parseDaysParam(req.query.days);
      const { start, end } = getDateRange(days);
      const startDateKey = toDayKey(start);
      const endDateKey = toDayKey(end);
      const dateKeys = buildDateKeys(start, end);

      const { data: reports, error } = await supabase
        .from("daily_reports")
        .select(
          `
          id,
          user_id,
          title,
          report_date,
          tasks_completed,
          attachments,
          status,
          created_at,
          users!daily_reports_user_id_fkey (name, email)
        `,
        )
        .gte("report_date", startDateKey)
        .lte("report_date", endDateKey)
        .order("report_date", { ascending: true });

      if (error) throw error;

      const reportRows = reports || [];

      const trendMap = new Map(
        dateKeys.map((day) => [
          day,
          { date: day, submitted: 0, on_time: 0, late: 0, attachments: 0 },
        ]),
      );

      const employeeMap = new Map();

      let totalOnTime = 0;
      let totalLate = 0;
      let totalAttachments = 0;
      let totalTasks = 0;

      for (const report of reportRows) {
        const reportDay = toDayKey(report.report_date || report.created_at);
        const createdDay = toDayKey(report.created_at);
        const isOnTime =
          reportDay && createdDay ? createdDay <= reportDay : Boolean(reportDay);

        const normalizedAttachments = normalizeAttachmentsArray(report.attachments);
        const attachmentCount = normalizedAttachments.length;
        const tasksCount = estimateTasksCount(report.tasks_completed);

        totalAttachments += attachmentCount;
        totalTasks += tasksCount;

        if (isOnTime) totalOnTime += 1;
        else totalLate += 1;

        if (reportDay && trendMap.has(reportDay)) {
          const trend = trendMap.get(reportDay);
          trend.submitted += 1;
          trend.attachments += attachmentCount;
          if (isOnTime) trend.on_time += 1;
          else trend.late += 1;
        }

        const existing = employeeMap.get(report.user_id) || {
          user_id: report.user_id,
          name: report.users?.name || "Unknown",
          email: report.users?.email || "",
          reports_count: 0,
          on_time_count: 0,
          late_count: 0,
          attachments_count: 0,
          tasks_count: 0,
          last_report_date: null,
        };

        existing.reports_count += 1;
        existing.attachments_count += attachmentCount;
        existing.tasks_count += tasksCount;
        if (isOnTime) existing.on_time_count += 1;
        else existing.late_count += 1;

        if (!existing.last_report_date || reportDay > existing.last_report_date) {
          existing.last_report_date = reportDay;
        }

        employeeMap.set(report.user_id, existing);
      }

      const employeePerformance = Array.from(employeeMap.values())
        .map((item) => {
          const onTimeRate =
            item.reports_count > 0
              ? (item.on_time_count / item.reports_count) * 100
              : 0;
          const submissionRate =
            dateKeys.length > 0 ? (item.reports_count / dateKeys.length) * 100 : 0;
          const disciplineScore = onTimeRate * 0.6 + submissionRate * 0.4;

          return {
            ...item,
            on_time_rate: parseFloat(onTimeRate.toFixed(2)),
            submission_rate: parseFloat(
              Math.min(100, submissionRate).toFixed(2),
            ),
            discipline_score: parseFloat(disciplineScore.toFixed(2)),
            discipline_level: getDisciplineLevel(disciplineScore),
          };
        })
        .sort((a, b) => {
          if (b.discipline_score !== a.discipline_score) {
            return b.discipline_score - a.discipline_score;
          }
          return b.reports_count - a.reports_count;
        });

      const totalReports = reportRows.length;
      const onTimeRate =
        totalReports > 0 ? parseFloat(((totalOnTime / totalReports) * 100).toFixed(2)) : 0;

      const summary = {
        total_reports: totalReports,
        active_employees: employeePerformance.length,
        on_time_reports: totalOnTime,
        late_reports: totalLate,
        on_time_rate: onTimeRate,
        total_attachments: totalAttachments,
        total_tasks: totalTasks,
        high_discipline_count: employeePerformance.filter(
          (item) => item.discipline_level === "high" || item.discipline_level === "good",
        ).length,
      };

      res.json({
        range: {
          days,
          start_date: startDateKey,
          end_date: endDateKey,
          total_days: dateKeys.length,
        },
        summary,
        flow: {
          submission_trend: dateKeys.map((day) => trendMap.get(day)),
          employee_performance: employeePerformance,
        },
      });
    } catch (error) {
      console.error("Error fetching reports analytics:", error);
      res.status(500).json({ error: "Failed to fetch reports analytics" });
    }
  },
);

// Create new report (with file uploads)
router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "files", maxCount: 10 },
    { name: "files[]", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const { title, description, tasks_completed, notes, report_date } =
        req.body;
      const userId = req.user.id;

      if (!title || !report_date) {
        return res.status(400).json({ error: "Title and date are required" });
      }

      const uploadedFilesInput = collectUploadedFiles(req);
      let attachments = [];
      if (uploadedFilesInput.length > 0) {
        try {
          attachments = await uploadReportFiles(uploadedFilesInput, userId);
        } catch (uploadError) {
          console.error("File upload error:", uploadError);
          return res.status(500).json({
            error: "Failed to upload report attachments",
          });
        }
      }

      const { data, error } = await supabase
        .from("daily_reports")
        .insert([
          {
            user_id: userId,
            title,
            description,
            tasks_completed,
            notes,
            report_date,
            attachments: normalizeAttachmentsArray(attachments),
            status: "submitted",
          },
        ])
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, report: data });
    } catch (error) {
      console.error("Error creating report:", error);
      res.status(500).json({ error: "Failed to create report" });
    }
  },
);

// Update report (with file uploads)
router.put(
  "/:id",
  authenticateToken,
  upload.fields([
    { name: "files", maxCount: 10 },
    { name: "files[]", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, tasks_completed, notes, report_date } =
        req.body;
      const userId = req.user.id;

      // Check if report exists and belongs to user (or user is admin)
      const { data: existing, error: fetchError } = await supabase
        .from("daily_reports")
        .select("user_id, attachments")
        .eq("id", id)
        .single();

      if (fetchError) {
        console.error("Error fetching report:", fetchError);
        return res.status(500).json({ error: "Failed to fetch report" });
      }

      if (!existing) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Check authorization: user must own the report or be admin
      if (existing.user_id !== userId && req.user.role !== "admin") {
        return res
          .status(403)
          .json({ error: "Access denied: insufficient permissions" });
      }

      // Keep only attachments that the user retained in the form
      let retainedAttachments = normalizeAttachmentsArray(existing.attachments);
      if (req.body.existing_attachments) {
        try {
          const parsed = JSON.parse(req.body.existing_attachments);
          retainedAttachments = normalizeAttachmentsArray(parsed);
        } catch (parseError) {
          return res
            .status(400)
            .json({ error: "Invalid existing_attachments payload" });
        }
      }

      // Handle new file uploads if any
      const uploadedFilesInput = collectUploadedFiles(req);
      let newAttachments = [];
      if (uploadedFilesInput.length > 0) {
        try {
          newAttachments = await uploadReportFiles(uploadedFilesInput, userId);
        } catch (uploadError) {
          console.error("File upload error:", uploadError);
          return res.status(500).json({ error: "Failed to upload files" });
        }
      }

      // Combine retained and new attachments
      const allAttachments = [
        ...normalizeAttachmentsArray(retainedAttachments),
        ...normalizeAttachmentsArray(newAttachments),
      ];

      const { data, error } = await supabase
        .from("daily_reports")
        .update({
          title,
          description,
          tasks_completed,
          notes,
          report_date,
          attachments: allAttachments,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      res.json({ success: true, report: data });
    } catch (error) {
      console.error("Error updating report:", error);
      res.status(500).json({ error: "Failed to update report" });
    }
  },
);

// Delete report
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if report exists and belongs to user (or user is admin)
    const { data: existing, error: fetchError } = await supabase
      .from("daily_reports")
      .select("user_id, attachments")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Error fetching report:", fetchError);
      return res.status(500).json({ error: "Failed to fetch report" });
    }

    if (!existing) {
      return res.status(404).json({ error: "Report not found" });
    }

    // Check authorization: user must own the report or be admin
    if (existing.user_id !== userId && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Access denied: insufficient permissions" });
    }

    // Best effort cleanup for stored attachments
    const storagePaths = normalizeAttachmentsArray(existing.attachments)
      .map((item) => item.storagePath)
      .filter(Boolean);
    if (storagePaths.length > 0) {
      await fileUploadService.deleteMultipleFiles(
        storagePaths,
        DAILY_REPORTS_BUCKET,
      );
    }

    const { error } = await supabase
      .from("daily_reports")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({ success: true, message: "Report deleted successfully" });
  } catch (error) {
    console.error("Error deleting report:", error);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "File exceeds 10MB limit",
      });
    }
    return res.status(400).json({ error: error.message });
  }

  if (error) {
    return res.status(400).json({ error: error.message || "File upload failed" });
  }

  return next();
});

export default router;
