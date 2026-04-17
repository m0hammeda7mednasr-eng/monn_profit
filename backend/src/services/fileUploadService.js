import { supabase } from "../supabaseClient.js";
import crypto from "crypto";

/**
 * File Upload Service
 * Handles file uploads to Supabase Storage
 */

export class FileUploadService {
  constructor() {
    this.bucketName = "daily-reports-attachments";
  }

  /**
   * Initialize storage bucket if it doesn't exist
   */
  async initializeBucket() {
    return this.ensureBucket(this.bucketName);
  }

  async ensureBucket(bucketName, options = {}) {
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const existingBucket = buckets?.find((b) => b.name === bucketName);
      const bucketExists = Boolean(existingBucket);
      const desiredPublic = options.public ?? false;
      const desiredFileSizeLimit = options.fileSizeLimit ?? 10485760;

      if (!bucketExists) {
        await supabase.storage.createBucket(bucketName, {
          public: desiredPublic,
          fileSizeLimit: desiredFileSizeLimit, // 10MB
        });
      } else {
        // Keep bucket settings aligned with requested upload policy.
        await supabase.storage.updateBucket(bucketName, {
          public: desiredPublic,
          fileSizeLimit: desiredFileSizeLimit,
        });
      }
    } catch (error) {
      console.error(`Error initializing bucket ${bucketName}:`, error);
      throw new Error(
        `Failed to prepare storage bucket "${bucketName}": ${error.message}`,
      );
    }
  }

  /**
   * Upload a file to Supabase Storage
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} fileName - Original file name
   * @param {string} mimeType - File MIME type
   * @param {string} userId - User ID
   * @param {Object} options - Upload options
   * @param {string} [options.bucketName] - Target bucket name
   * @param {string} [options.prefix] - Optional object path prefix
   * @returns {Promise<Object>} Upload result with file URL
   */
  async uploadFile(fileBuffer, fileName, mimeType, userId, options = {}) {
    try {
      const targetBucket = options.bucketName || this.bucketName;
      // Generate unique file name
      const fileExt = fileName.split(".").pop();
      const basePath = options.prefix
        ? `${options.prefix}/${userId}`
        : `${userId}`;
      const uniqueFileName = `${basePath}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${fileExt}`;

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from(targetBucket)
        .upload(uniqueFileName, fileBuffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (error) throw error;

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from(targetBucket).getPublicUrl(uniqueFileName);

      return {
        success: true,
        fileName: fileName,
        bucket: targetBucket,
        storagePath: data.path,
        url: publicUrl,
        size: fileBuffer.length,
        mimeType: mimeType,
      };
    } catch (error) {
      console.error("Error uploading file:", error);
      throw new Error(`فشل رفع الملف: ${error.message}`);
    }
  }

  /**
   * Upload multiple files
   * @param {Array} files - Array of file objects {buffer, name, mimeType}
   * @param {string} userId - User ID
   * @param {Object} options - Upload options
   * @returns {Promise<Array>} Array of upload results
   */
  async uploadMultipleFiles(files, userId, options = {}) {
    const uploadPromises = files.map((file) =>
      this.uploadFile(file.buffer, file.name, file.mimeType, userId, options),
    );

    try {
      const results = await Promise.all(uploadPromises);
      return results;
    } catch (error) {
      console.error("Error uploading multiple files:", error);
      throw error;
    }
  }

  /**
   * Delete a file from storage
   * @param {string} filePath - File path in storage
   * @param {string} [bucketName] - Target bucket name
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(filePath, bucketName = this.bucketName) {
    try {
      const { error } = await supabase.storage
        .from(bucketName)
        .remove([filePath]);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error deleting file:", error);
      return false;
    }
  }

  /**
   * Delete multiple files
   * @param {Array<string>} filePaths - Array of file paths
   * @param {string} [bucketName] - Target bucket name
   * @returns {Promise<boolean>} Success status
   */
  async deleteMultipleFiles(filePaths, bucketName = this.bucketName) {
    try {
      const { error } = await supabase.storage
        .from(bucketName)
        .remove(filePaths);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error deleting multiple files:", error);
      return false;
    }
  }
}

export default new FileUploadService();
