import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  CreditCard,
  Edit3,
  Eye,
  EyeOff,
  MessageCircle,
  MessageSquare,
  Pin,
  PinOff,
  Send,
  Shield,
  Trash2,
  Truck,
  User,
} from "lucide-react";
import api from "../utils/api";
import { formatDateTime, formatNumber } from "../utils/helpers";

const TYPE_STYLES = {
  blue: {
    icon: "bg-blue-100 text-blue-600",
    pill: "bg-blue-100 text-blue-700",
  },
  green: {
    icon: "bg-green-100 text-green-600",
    pill: "bg-green-100 text-green-700",
  },
  purple: {
    icon: "bg-purple-100 text-purple-600",
    pill: "bg-purple-100 text-purple-700",
  },
  orange: {
    icon: "bg-orange-100 text-orange-600",
    pill: "bg-orange-100 text-orange-700",
  },
  teal: {
    icon: "bg-teal-100 text-teal-600",
    pill: "bg-teal-100 text-teal-700",
  },
  red: {
    icon: "bg-red-100 text-red-600",
    pill: "bg-red-100 text-red-700",
  },
};

const OrderComments = ({ orderId, orderNumber, legacyOrderId = null }) => {
  const { user, isAdmin } = useAuth();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [commentType, setCommentType] = useState("general");
  const [isInternal, setIsInternal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [showInternal, setShowInternal] = useState(true);
  const [mode, setMode] = useState("table");

  const commentTypes = [
    { value: "general", label: "عام", icon: MessageSquare, color: "blue" },
    {
      value: "status_change",
      label: "تغيير حالة",
      icon: CheckCircle,
      color: "green",
    },
    { value: "payment", label: "دفع", icon: CreditCard, color: "purple" },
    { value: "shipping", label: "شحن", icon: Truck, color: "orange" },
    {
      value: "customer_service",
      label: "خدمة العملاء",
      icon: User,
      color: "teal",
    },
    { value: "internal", label: "داخلي", icon: Shield, color: "red" },
  ];

  const fetchComments = useCallback(
    async ({ silent = false } = {}) => {
      if (!orderId) return;
      try {
        if (!silent) setLoading(true);
        const response = await api.get(`/order-comments/order/${orderId}`);
        setComments(response.data.data || []);
        setMode(response.data.mode || "table");
      } catch (error) {
        console.error("Error fetching comments:", error);
        if (!silent) {
          setComments([]);
          setMode("legacy");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    if (!orderId) {
      setComments([]);
      setMode("table");
      setLoading(false);
      return;
    }

    fetchComments();

    const intervalId = setInterval(() => {
      fetchComments({ silent: true });
    }, 15000);

    const onFocus = () => {
      fetchComments({ silent: true });
    };

    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [orderId, fetchComments]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !orderId) return;

    try {
      setSubmitting(true);

      if (mode === "legacy" && legacyOrderId) {
        await api.post(`/shopify/orders/${legacyOrderId}/notes`, {
          content: newComment.trim(),
        });
      } else {
        await api.post("/order-comments", {
          order_id: orderId,
          comment_text: newComment.trim(),
          comment_type: commentType,
          is_internal: isInternal,
        });
      }

      await fetchComments({ silent: true });

      setNewComment("");
      setCommentType("general");
      setIsInternal(false);
    } catch (error) {
      console.error("Error adding comment:", error);
      window.alert("فشل في إضافة التعليق");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (commentId) => {
    if (!editText.trim() || mode !== "table") return;

    try {
      const response = await api.put(`/order-comments/${commentId}`, {
        comment_text: editText.trim(),
      });

      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId ? response.data.data : comment,
        ),
      );
      setEditingId(null);
      setEditText("");
    } catch (error) {
      console.error("Error updating comment:", error);
      window.alert("فشل في تحديث التعليق");
    }
  };

  const handleDelete = async (commentId) => {
    if (mode !== "table") return;
    if (!window.confirm("هل أنت متأكد من حذف هذا التعليق؟")) return;

    try {
      await api.delete(`/order-comments/${commentId}`);
      setComments((prev) => prev.filter((comment) => comment.id !== commentId));
    } catch (error) {
      console.error("Error deleting comment:", error);
      window.alert("فشل في حذف التعليق");
    }
  };

  const handlePin = async (commentId, isPinned) => {
    if (mode !== "table") return;
    try {
      await api.patch(`/order-comments/${commentId}/pin`, {
        is_pinned: !isPinned,
      });

      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId
            ? { ...comment, is_pinned: !isPinned }
            : comment,
        ),
      );
    } catch (error) {
      console.error("Error pinning comment:", error);
      window.alert("فشل في تثبيت التعليق");
    }
  };

  const getTypeConfig = (type) =>
    commentTypes.find((item) => item.value === type) || commentTypes[0];

  const formatDate = (dateString) =>
    formatDateTime(dateString, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const filteredComments = comments.filter(
    (comment) => showInternal || !comment.is_internal,
  );

  const pinnedComments = filteredComments.filter(
    (comment) => comment.is_pinned,
  );
  const regularComments = filteredComments.filter(
    (comment) => !comment.is_pinned,
  );
  const canUseAdvancedFeatures = mode === "table";

  if (loading) {
    return (
      <div className="app-surface rounded-[28px] p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-surface rounded-[28px]">
      <div className="border-b border-slate-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="text-blue-600" size={24} />
            <div>
              <h3 className="text-lg font-semibold text-gray-800">
                تعليقات الطلب #{orderNumber}
              </h3>
              <p className="text-sm text-gray-600">
                {formatNumber(filteredComments.length, {
                  maximumFractionDigits: 0,
                })} تعليق
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === "legacy" && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                وضع التعليقات الاحتياطي
              </span>
            )}
            {isAdmin && canUseAdvancedFeatures && (
              <button
                onClick={() => setShowInternal(!showInternal)}
                className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium transition ${
                  showInternal
                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                    : "app-button-secondary text-slate-700"
                }`}
              >
                {showInternal ? <EyeOff size={16} /> : <Eye size={16} />}
                {showInternal ? "إخفاء الداخلية" : "إظهار الداخلية"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
        {!orderId && (
          <div className="text-center py-8 text-gray-500">
            <AlertCircle size={48} className="mx-auto mb-3 text-gray-300" />
            <p>لا يمكن إضافة تعليقات لهذا الطلب حاليًا</p>
          </div>
        )}

        {orderId && pinnedComments.length > 0 && canUseAdvancedFeatures && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
              <Pin size={16} />
              التعليقات المثبتة
            </div>
            {pinnedComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                user={user}
                isAdmin={isAdmin}
                editingId={editingId}
                editText={editText}
                setEditingId={setEditingId}
                setEditText={setEditText}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onPin={handlePin}
                getTypeConfig={getTypeConfig}
                formatDate={formatDate}
                canUseAdvancedFeatures={canUseAdvancedFeatures}
              />
            ))}
          </div>
        )}

        {orderId && regularComments.length > 0 ? (
          <div className="space-y-3">
            {pinnedComments.length > 0 && canUseAdvancedFeatures && (
              <div className="border-t border-gray-200 pt-4">
                <div className="text-sm font-medium text-gray-600 mb-3">
                  التعليقات العادية
                </div>
              </div>
            )}
            {regularComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                user={user}
                isAdmin={isAdmin}
                editingId={editingId}
                editText={editText}
                setEditingId={setEditingId}
                setEditText={setEditText}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onPin={handlePin}
                getTypeConfig={getTypeConfig}
                formatDate={formatDate}
                canUseAdvancedFeatures={canUseAdvancedFeatures}
              />
            ))}
          </div>
        ) : orderId && pinnedComments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageCircle size={48} className="mx-auto mb-3 text-gray-300" />
            <p>لا توجد تعليقات على هذا الطلب بعد</p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {canUseAdvancedFeatures && (
            <div className="flex gap-4">
              <select
                value={commentType}
                onChange={(e) => setCommentType(e.target.value)}
                className="app-input max-w-[220px] px-3 py-2.5 text-sm"
              >
                {commentTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              {isAdmin && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-red-600 font-medium">داخلي</span>
                </label>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="اكتب تعليقك هنا..."
              rows={3}
              className="app-input flex-1 resize-none px-4 py-3 text-sm"
              disabled={submitting || !orderId}
            />
            <button
              type="submit"
              disabled={submitting || !newComment.trim() || !orderId}
              className="app-button-primary flex items-center gap-2 rounded-2xl px-6 py-3 text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={16} />
              {submitting ? "جاري الإرسال..." : "إرسال"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const CommentItem = ({
  comment,
  user,
  isAdmin,
  editingId,
  editText,
  setEditingId,
  setEditText,
  onEdit,
  onDelete,
  onPin,
  getTypeConfig,
  formatDate,
  canUseAdvancedFeatures,
}) => {
  const typeConfig = getTypeConfig(comment.comment_type);
  const TypeIcon = typeConfig.icon;
  const isOwner = comment.user_id === user?.id;
  const canEdit = canUseAdvancedFeatures && (isOwner || isAdmin);
  const style = TYPE_STYLES[typeConfig.color] || TYPE_STYLES.blue;

  return (
    <div
      className={`rounded-[22px] border-l-4 p-4 shadow-sm ${
        comment.is_pinned
          ? "bg-amber-50 border-amber-400"
          : comment.is_internal
            ? "bg-red-50 border-red-400"
            : "bg-slate-50 border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${style.icon}`}>
            <TypeIcon size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800">
                {comment.user_name || "مستخدم"}
              </span>
              {comment.user_role === "admin" && (
                <Shield size={14} className="text-purple-600" />
              )}
              <span
                className={`px-2 py-1 rounded-full text-xs font-medium ${style.pill}`}
              >
                {typeConfig.label}
              </span>
              {comment.is_internal && (
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                  داخلي
                </span>
              )}
              {comment.is_pinned && (
                <Pin size={14} className="text-amber-600" />
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
              <Clock size={12} />
              {formatDate(comment.created_at)}
              {comment.edited_at && (
                <span className="text-orange-600">
                  • تم التعديل {formatDate(comment.edited_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button
                onClick={() => onPin(comment.id, comment.is_pinned)}
                className={`rounded-lg p-1.5 transition hover:bg-slate-200 ${
                  comment.is_pinned ? "text-amber-600" : "text-gray-400"
                }`}
                title={comment.is_pinned ? "إلغاء التثبيت" : "تثبيت"}
              >
                {comment.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
            )}
            <button
              onClick={() => {
                setEditingId(comment.id);
                setEditText(comment.comment_text);
              }}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-slate-200 hover:text-blue-600"
              title="تعديل"
            >
              <Edit3 size={16} />
            </button>
            <button
              onClick={() => onDelete(comment.id)}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-slate-200 hover:text-red-600"
              title="حذف"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      {editingId === comment.id ? (
        <div className="space-y-3">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="app-input w-full resize-none px-3 py-2.5 text-sm"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(comment.id)}
              className="app-button-primary rounded-xl px-4 py-2 text-sm font-semibold text-white"
            >
              حفظ
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                setEditText("");
              }}
              className="app-button-secondary rounded-xl px-4 py-2 text-sm font-semibold text-slate-700"
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
          {comment.comment_text}
        </p>
      )}
    </div>
  );
};

export default OrderComments;
