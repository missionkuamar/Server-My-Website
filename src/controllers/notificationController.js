import Notification from "../models/Notification.js";
import ApiError from "../utils/ApiError.js";

// GET: My notifications
export const getMyNotifications = async (req, res, next) => {
  try {
    const {
      search = "",
      filter = "all",     // all | unread | read
      type = "all",       // purchase, payment, system, etc.
      page = 1,
      limit = 10,
    } = req.query;

    // ---------- Filter ----------
    const query = { user: req.user._id };

    if (search.trim()) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: "i" } },
        { message: { $regex: q, $options: "i" } },
      ];
    }

    if (filter === "unread") query.isRead = false;
    else if (filter === "read") query.isRead = true;

    if (type !== "all") query.type = type;

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [notifications, totalCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Notification.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Global stats (unfiltered) ----------
    const [totalAll, unreadAll] = await Promise.all([
      Notification.countDocuments({ user: req.user._id }),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.json({
      success: true,
      notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      stats: {
        total: totalAll,
        unread: unreadAll,
        read: totalAll - unreadAll,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT: Mark one as read
export const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { returnDocument: "after" }
    );

    if (!notification) throw new ApiError(404, "Notification not found");

    res.json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

// PUT: Mark all as read
export const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );
    res.json({ success: true, message: "All marked as read" });
  } catch (error) {
    next(error);
  }
};

// DELETE: Delete one
export const deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) throw new ApiError(404, "Notification not found");

    res.json({ success: true, message: "Deleted" });
  } catch (error) {
    next(error);
  }
};

// DELETE: Clear all
export const clearAllNotifications = async (req, res, next) => {
  try {
    await Notification.deleteMany({ user: req.user._id });
    res.json({ success: true, message: "All cleared" });
  } catch (error) {
    next(error);
  }
};

// HELPER: Create notification (import karke use karo)
export const createNotification = async (userId, data) => {
  try {
    await Notification.create({
      user: userId,
      ...data,
    });
  } catch (error) {
    console.error("Notification create failed:", error);
  }
};