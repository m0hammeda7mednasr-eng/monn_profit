import { supabase } from "../supabaseClient.js";

class NotificationService {
  async createNotification({
    userId,
    type,
    title,
    message,
    entityType = null,
    entityId = null,
    metadata = {},
  }) {
    if (!userId) {
      return null;
    }

    const { data, error } = await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        type,
        title,
        message,
        entity_type: entityType,
        entity_id: entityId,
        metadata,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async markAsRead(notificationId, userId) {
    const { data, error } = await supabase
      .from("notifications")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async markAllAsRead(userId) {
    const { error } = await supabase
      .from("notifications")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      throw error;
    }
  }
}

export default new NotificationService();
