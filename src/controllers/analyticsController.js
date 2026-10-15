import Payment from "../models/Payment.js";
import Purchase from "../models/Purchase.js";
import Project from "../models/Project.js";
import User from "../models/User.js";

/* ============================================================
   Helper: Get date range based on filter
   ============================================================ */
const getDateRange = (range) => {
  const now = new Date();
  const start = new Date();

  switch (range) {
    case "day":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      start.setDate(now.getDate() - 7);
      break;
    case "month":
      start.setMonth(now.getMonth() - 1);
      break;
    case "4months":
      start.setMonth(now.getMonth() - 4);
      break;
    case "6months":
      start.setMonth(now.getMonth() - 6);
      break;
    case "year":
      start.setFullYear(now.getFullYear() - 1);
      break;
    case "5years":
      start.setFullYear(now.getFullYear() - 5);
      break;
    case "all":
    default:
      return null; // no filter
  }

  return { $gte: start, $lte: now };
};

/* ============================================================
   Helper: Group format based on range
   ============================================================ */
const getGroupFormat = (range) => {
  if (range === "day" || range === "week") {
    return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  }
  if (range === "month" || range === "4months" || range === "6months") {
    return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  }
  // year, 5years, all
  return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
};

/* ============================================================
   GET: Revenue Chart Data
   ============================================================ */
export const getRevenueChart = async (req, res, next) => {
  try {
    const { range = "month" } = req.query;
    const dateRange = getDateRange(range);

    const matchStage = { status: "paid" };
    if (dateRange) matchStage.createdAt = dateRange;

    const groupFormat = getGroupFormat(range);

    // Revenue from payments (star purchases)
    const payments = await Payment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupFormat,
          revenue: { $sum: { $divide: ["$amount", 100] } }, // paise → rupees
          stars: { $sum: "$stars" },
          transactions: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Project sales (stars spent by users)
    const purchaseMatchStage = {};
    if (dateRange) purchaseMatchStage.createdAt = dateRange;

    const projectSales = await Purchase.aggregate([
      { $match: purchaseMatchStage },
      {
        $group: {
          _id: groupFormat,
          starsSpent: { $sum: "$starsSpent" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Merge both
    const merged = {};
    payments.forEach((p) => {
      merged[p._id] = {
        date: p._id,
        revenue: p.revenue,
        stars: p.stars,
        transactions: p.transactions,
        starsSpent: 0,
        orders: 0,
      };
    });
    projectSales.forEach((p) => {
      if (merged[p._id]) {
        merged[p._id].starsSpent = p.starsSpent;
        merged[p._id].orders = p.orders;
      } else {
        merged[p._id] = {
          date: p._id,
          revenue: 0,
          stars: 0,
          transactions: 0,
          starsSpent: p.starsSpent,
          orders: p.orders,
        };
      }
    });

    const data = Object.values(merged).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    res.json({ success: true, data, range });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   GET: User Growth Chart
   ============================================================ */
export const getUserGrowthChart = async (req, res, next) => {
  try {
    const { range = "month" } = req.query;
    const dateRange = getDateRange(range);

    const matchStage = {};
    if (dateRange) matchStage.createdAt = dateRange;

    const groupFormat = getGroupFormat(range);

    const data = await User.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupFormat,
          users: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: data.map((d) => ({ date: d._id, users: d.users })),
      range,
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   GET: Sales Chart (project purchases over time)
   ============================================================ */
export const getSalesChart = async (req, res, next) => {
  try {
    const { range = "month" } = req.query;
    const dateRange = getDateRange(range);

    const matchStage = {};
    if (dateRange) matchStage.createdAt = dateRange;

    const groupFormat = getGroupFormat(range);

    const data = await Purchase.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupFormat,
          sales: { $sum: 1 },
          starsSpent: { $sum: "$starsSpent" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: data.map((d) => ({
        date: d._id,
        sales: d.sales,
        starsSpent: d.starsSpent,
      })),
      range,
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   GET: Overview Stats (total revenue, users, downloads, etc.)
   ============================================================ */
export const getOverviewStats = async (req, res, next) => {
  try {
    const { range = "month" } = req.query;
    const dateRange = getDateRange(range);

    const payMatch = { status: "paid" };
    const purchaseMatch = {};
    const userMatch = {};
    const projectMatch = { isActive: true };

    if (dateRange) {
      payMatch.createdAt = dateRange;
      purchaseMatch.createdAt = dateRange;
      userMatch.createdAt = dateRange;
      projectMatch.createdAt = dateRange;
    }

    const [
      totalRevenueAgg,
      totalUsers,
      totalProjects,
      totalDownloadsAgg,
      totalOrders,
      totalStars,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: payMatch },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      User.countDocuments(userMatch),
      Project.countDocuments(projectMatch),
      Project.aggregate([
        { $match: projectMatch },
        { $group: { _id: null, total: { $sum: "$downloads" } } },
      ]),
      Purchase.countDocuments(purchaseMatch),
      Payment.aggregate([
        { $match: payMatch },
        { $group: { _id: null, total: { $sum: "$stars" } } },
      ]),
    ]);

    res.json({
      success: true,
      stats: {
        totalRevenue: (totalRevenueAgg[0]?.total || 0) / 100,
        totalUsers,
        totalProjects,
        totalDownloads: totalDownloadsAgg[0]?.total || 0,
        totalOrders,
        totalStars: totalStars[0]?.total || 0,
      },
      range,
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   GET: Top Performing Projects
   ============================================================ */
export const getTopProjects = async (req, res, next) => {
  try {
    const { range = "month", limit = 5 } = req.query;
    const dateRange = getDateRange(range);

    // Get project IDs with purchases in date range
    const purchaseMatch = {};
    if (dateRange) purchaseMatch.createdAt = dateRange;

    const topProjectIds = await Purchase.aggregate([
      { $match: purchaseMatch },
      {
        $group: {
          _id: "$project",
          purchases: { $sum: 1 },
          starsEarned: { $sum: "$starsSpent" },
        },
      },
      { $sort: { purchases: -1 } },
      { $limit: Number(limit) },
    ]);

    // Fetch full project details
    const projectIds = topProjectIds.map((p) => p._id);
    const projects = await Project.find({ _id: { $in: projectIds } });

    const result = topProjectIds.map((tp) => {
      const project = projects.find(
        (p) => p._id.toString() === tp._id.toString()
      );
      return {
        _id: tp._id,
        title: project?.title || "Unknown",
        price: project?.price || 0,
        thumbnail: project?.thumbnail || "",
        purchases: tp.purchases,
        starsEarned: tp.starsEarned,
        downloads: project?.downloads || 0,
      };
    });

    res.json({ success: true, projects: result, range });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   GET: Role Distribution (pie chart)
   ============================================================ */
export const getRoleDistribution = async (req, res, next) => {
  try {
    const data = await User.aggregate([
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]);

    const roles = {
      user: 0,
      admin: 0,
      moderator: 0,
    };
    data.forEach((r) => {
      roles[r._id] = r.count;
    });

    res.json({
      success: true,
      distribution: [
        { name: "Users", value: roles.user },
        { name: "Admins", value: roles.admin },
        { name: "Moderators", value: roles.moderator },
      ],
    });
  } catch (error) {
    next(error);
  }
};