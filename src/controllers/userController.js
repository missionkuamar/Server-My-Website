import User from "../models/User.js";
import Purchase from "../models/Purchase.js";
import Payment from "../models/Payment.js";
import ApiError from "../utils/ApiError.js";
import { createNotification } from "./notificationController.js";

/* ============================================================
   GET: All users with search, filter, sort, pagination
   ============================================================ */
export const getAllUsers = async (req, res, next) => {
  try {
    const {
      search = "",
      role = "all",
      status = "all",
      sortBy = "newest",
      page = 1,
      limit = 10,
    } = req.query;

    // ---------- Filter ----------
    const filter = {};

    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
    }

    if (role !== "all") filter.role = role;
    if (status !== "all") filter.status = status;

    // ---------- Sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "stars-high": { stars: -1 },
      "stars-low": { stars: 1 },
      name: { name: 1 },
      "last-active": { lastLogin: -1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [users, totalCount] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Global stats (unfiltered) ----------
    const [totalAll, adminCount, modCount, userCount, blockedCount] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "admin" }),
        User.countDocuments({ role: "moderator" }),
        User.countDocuments({ role: "user" }),
        User.countDocuments({ status: { $ne: "active" } }),
      ]);

    res.json({
      success: true,
      users,
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
        admins: adminCount,
        moderators: modCount,
        users: userCount,
        blocked: blockedCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   GET: Single user with full details
   ============================================================ */
export const getUserDetails = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) throw new ApiError(404, "User not found");

    // Purchases
    const purchases = await Purchase.find({ user: user._id })
      .populate("project", "title price thumbnail")
      .sort({ createdAt: -1 })
      .limit(20);

    // Payments
    const payments = await Payment.find({ user: user._id, status: "paid" })
      .sort({ createdAt: -1 })
      .limit(20);

    // Stats
    const totalSpent = payments.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0
    );

    res.json({
      success: true,
      user,
      purchases,
      payments,
      stats: {
        totalPurchases: purchases.length,
        totalSpent: totalSpent / 100,
        totalStars: payments.reduce((sum, p) => sum + (p.stars || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUT: Block user
   ============================================================ */
export const blockUser = async (req, res, next) => {
  try {
    const { reason = "" } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, "User not found");

    if (user.role === "admin" && user._id.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Cannot block another admin");
    }

    user.status = "blocked";
    user.blockReason = reason;
    await user.save();

    // Notify user
    await createNotification(user._id, {
      title: "Account Blocked",
      message: `Your account has been temporarily blocked. Reason: ${reason || "Contact support"}`,
      type: "alert",
    });

    res.json({
      success: true,
      message: "User blocked successfully",
      user: { _id: user._id, status: user.status },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUT: Unblock user
   ============================================================ */
export const unblockUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, "User not found");

    user.status = "active";
    user.blockReason = "";
    user.banReason = "";
    user.suspendedUntil = null;
    await user.save();

    await createNotification(user._id, {
      title: "Account Restored",
      message: "Your account has been restored. Welcome back!",
      type: "success",
    });

    res.json({
      success: true,
      message: "User unblocked",
      user: { _id: user._id, status: user.status },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUT: Ban user (permanent)
   ============================================================ */
export const banUser = async (req, res, next) => {
  try {
    const { reason = "" } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, "User not found");

    if (user.role === "admin" && user._id.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Cannot ban another admin");
    }

    user.status = "banned";
    user.banReason = reason;
    await user.save();

    await createNotification(user._id, {
      title: "Account Banned",
      message: `Your account has been permanently banned. Reason: ${reason || "Terms violation"}`,
      type: "alert",
    });

    res.json({
      success: true,
      message: "User banned",
      user: { _id: user._id, status: user.status },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUT: Suspend user (temporary)
   ============================================================ */
export const suspendUser = async (req, res, next) => {
  try {
    const { reason = "", days = 7 } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, "User not found");

    const until = new Date();
    until.setDate(until.getDate() + Number(days));

    user.status = "suspended";
    user.blockReason = reason;
    user.suspendedUntil = until;
    await user.save();

    await createNotification(user._id, {
      title: "Account Suspended",
      message: `Your account is suspended until ${until.toLocaleDateString()}. Reason: ${reason || "N/A"}`,
      type: "alert",
    });

    res.json({
      success: true,
      message: `User suspended for ${days} days`,
      user: { _id: user._id, status: user.status, suspendedUntil: until },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUT: Update role
   ============================================================ */
export const updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!["user", "moderator", "admin"].includes(role)) {
      throw new ApiError(400, "Invalid role");
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { returnDocument: "after" }
    ).select("-password");

    if (!user) throw new ApiError(404, "User not found");

    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUT: Add / Remove stars (admin adjust)
   ============================================================ */
export const adjustStars = async (req, res, next) => {
  try {
    const { amount = 0, action = "add" } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, "User not found");

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) throw new ApiError(400, "Invalid amount");

    if (action === "add") user.stars += amt;
    else if (action === "remove") user.stars = Math.max(0, user.stars - amt);
    else throw new ApiError(400, "Invalid action");

    await user.save();

    res.json({
      success: true,
      message: `Stars ${action === "add" ? "added" : "removed"}`,
      user: { _id: user._id, stars: user.stars },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   DELETE: Delete user
   ============================================================ */
export const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, "User not found");

    if (user._id.toString() === req.user._id.toString()) {
      throw new ApiError(400, "Cannot delete yourself");
    }

    await User.findByIdAndDelete(user._id);
    res.json({ success: true, message: "User deleted" });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   POST: Bulk action (block/unblock/delete multiple users)
   ============================================================ */
export const bulkAction = async (req, res, next) => {
  try {
    const { userIds = [], action, reason = "" } = req.body;

    if (!userIds.length) throw new ApiError(400, "No users selected");
    if (!["block", "unblock", "ban", "delete"].includes(action)) {
      throw new ApiError(400, "Invalid action");
    }

    // Prevent self-modification
    const filtered = userIds.filter(
      (id) => id !== req.user._id.toString()
    );

    let result = { modified: 0, deleted: 0 };

    if (action === "delete") {
      const r = await User.deleteMany({ _id: { $in: filtered } });
      result.deleted = r.deletedCount;
    } else {
      const update = {};
      if (action === "block") {
        update.status = "blocked";
        update.blockReason = reason;
      } else if (action === "unblock") {
        update.status = "active";
        update.blockReason = "";
        update.banReason = "";
        update.suspendedUntil = null;
      } else if (action === "ban") {
        update.status = "banned";
        update.banReason = reason;
      }

      const r = await User.updateMany({ _id: { $in: filtered } }, update);
      result.modified = r.modifiedCount;
    }

    res.json({
      success: true,
      message: `Bulk ${action} complete`,
      result,
    });
  } catch (error) {
    next(error);
  }
};


/* ============================================================
   GET: Daily bonus status
   ============================================================ */
export const getDailyBonusStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select(
      "stars lastClaimAt claimStreak totalClaims"
    );
    if (!user) throw new ApiError(404, "User not found");

    const now = new Date();
    const canClaim = user.canClaimDaily();
    const nextClaimAt = canClaim ? null : user.getNextClaimTime();

    // Time remaining in seconds
    let timeRemaining = 0;
    if (!canClaim && nextClaimAt) {
      timeRemaining = Math.max(
        0,
        Math.floor((nextClaimAt - now) / 1000)
      );
    }

    res.json({
      success: true,
      canClaim,
      currentStars: user.stars,
      dailyReward: 3,
      streak: user.claimStreak || 0,
      totalClaims: user.totalClaims || 0,
      lastClaimAt: user.lastClaimAt,
      nextClaimAt,
      timeRemaining, // seconds
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   POST: Claim daily bonus
   ============================================================ */
export const claimDailyBonus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw new ApiError(404, "User not found");

    // Check blocked/banned
    if (user.status !== "active") {
      throw new ApiError(403, "Account is not active");
    }

    // Check cooldown
    if (!user.canClaimDaily()) {
      const nextClaimAt = user.getNextClaimTime();
      const hoursLeft = (
        (nextClaimAt - new Date()) /
        (1000 * 60 * 60)
      ).toFixed(1);

      throw new ApiError(
        400,
        `Already claimed! Next reward in ${hoursLeft} hours.`
      );
    }

    // Reward logic (with streak bonus)
    const BASE_REWARD = 2;
    let bonusStars = 0;

    // ⬇️ Bonus on 7-day streak
    if (user.claimStreak >= 6) {
      bonusStars = 5;
    }

    const totalReward = BASE_REWARD + bonusStars;

    // Check streak continuity
    const now = new Date();
    let newStreak = 1;

    if (user.lastClaimAt) {
      const last = new Date(user.lastClaimAt);
      const hoursSince = (now - last) / (1000 * 60 * 60);

      // If claimed within 48 hours → continue streak
      if (hoursSince < 48) {
        newStreak = (user.claimStreak || 0) + 1;
      }
      // else streak resets to 1
    }

    // Update user
    user.stars += totalReward;
    user.lastClaimAt = now;
    user.claimStreak = newStreak;
    user.totalClaims = (user.totalClaims || 0) + 1;

    await user.save();

    res.json({
      success: true,
      message: `🎉 +${totalReward} stars claimed!`,
      starsAwarded: totalReward,
      baseReward: BASE_REWARD,
      bonusStars,
      newBalance: user.stars,
      streak: newStreak,
      nextClaimAt: user.getNextClaimTime(),
    });
  } catch (error) {
    next(error);
  }
};