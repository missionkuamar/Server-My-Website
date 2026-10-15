import Project from "../models/Project.js";
import Purchase from "../models/Purchase.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import s3 from "../config/s3.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


// ADMIN: Upload Project
export const uploadProject = async (req, res, next) => {
  try {
    const {
      title,
      description,
      price,
      originalPrice,
      techStack,
      tags,
      category,
      liveLink,
      videoLink,
      githubLink,
      isFeatured,
    } = req.body;

    // -------- Files --------
    const zipFile = req.files?.zip?.[0];
    const thumbnailFile = req.files?.thumbnail?.[0];
    const galleryFiles = req.files?.gallery || [];

    // -------- Validation --------
    if (!zipFile) throw new ApiError(400, "ZIP file is required");
    if (!title || !description || !price) {
      throw new ApiError(400, "Title, description, price are required");
    }
    if (galleryFiles.length > 20) {
      throw new ApiError(400, "Max 20 gallery images allowed");
    }

    // -------- Parse arrays from strings --------
    const parsedTechStack = techStack
      ? typeof techStack === "string"
        ? techStack.split(",").map((t) => t.trim()).filter(Boolean)
        : techStack
      : [];

    const parsedTags = tags
      ? typeof tags === "string"
        ? tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
        : tags
      : [];

    // -------- Build gallery array --------
    const gallery = galleryFiles.map((f, idx) => ({
      url: f.location,
      key: f.key,
      caption: "",
    }));

    // -------- Create project --------
    const project = await Project.create({
      title: title.trim(),
      description: description.trim(),
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : 0,

      // Images
      thumbnail: thumbnailFile?.location || "",
      thumbnailKey: thumbnailFile?.key || "",
      gallery,

      // ZIP
      zipUrl: zipFile.location,
      zipKey: zipFile.key,
      fileSize: zipFile.size,

      // Tech + tags
      techStack: parsedTechStack,
      tags: parsedTags,
      category: category || "web",

      // Links
      liveLink: liveLink?.trim() || "",
      videoLink: videoLink?.trim() || "",
      githubLink: githubLink?.trim() || "",

      // Status
      isFeatured: isFeatured === "true" || isFeatured === true,

      // Owner
      uploadedBy: req.user._id,
    });

    res.status(201).json({ success: true, project });
  } catch (error) {
    next(error);
  }
};

// PUBLIC: Get All Projects
export const getProjects = async (req, res, next) => {
  try {
    const {
      search = "",
      category = "all",
      priceFilter = "all",
      sortBy = "newest",
      page = 1,
      limit = 9,
    } = req.query;

    // ---------- Filter ----------
    const filter = { isActive: true };

    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { techStack: { $in: [new RegExp(q, "i")] } },
        { tags: { $in: [new RegExp(q, "i")] } },
      ];
    }

    if (category !== "all") filter.category = category;

    if (priceFilter === "free") {
      filter.price = 0;
    } else if (priceFilter === "low") {
      filter.price = { $gt: 0, $lte: 50 };
    } else if (priceFilter === "mid") {
      filter.price = { $gt: 50, $lte: 200 };
    } else if (priceFilter === "high") {
      filter.price = { $gt: 200 };
    }

    // ---------- Sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "price-low": { price: 1 },
      "price-high": { price: -1 },
      popular: { downloads: -1 },
      featured: { isFeatured: -1, createdAt: -1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 9));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [projects, totalCount] = await Promise.all([
      Project.find(filter)
        .populate("uploadedBy", "name")
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .select("-zipUrl -zipKey"), // security — zip URL mat bhejo list me
      Project.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Global stats (unfiltered) ----------
    const [totalAll, featuredCount, freeCount] = await Promise.all([
      Project.countDocuments({ isActive: true }),
      Project.countDocuments({ isActive: true, isFeatured: true }),
      Project.countDocuments({ isActive: true, price: 0 }),
    ]);

    // ---------- Category list ----------
    const categoriesAgg = await Project.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const categories = categoriesAgg.map((c) => ({
      name: c._id || "other",
      count: c.count,
    }));

    res.json({
      success: true,
      projects,
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
        featured: featuredCount,
        free: freeCount,
      },
      categories,
    });
  } catch (error) {
    next(error);
  }
};

// Get Single Project
// Get Single Project
export const getProjectById = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id).populate(
      "uploadedBy",
      "name email"
    );
    if (!project) throw new ApiError(404, "Project not found");

    let isPurchased = false;
    let isExpired = false;
    let expiresAt = null;
    let daysRemaining = 0;
    let renewalCount = 0;

    if (req.user) {
      const purchase = await Purchase.findOne({
        user: req.user._id,
        project: project._id,
      });

      if (purchase) {
        isPurchased = true;
        expiresAt = purchase.expiresAt;
        renewalCount = purchase.renewalCount || 0;

        const now = new Date();
        isExpired = now > new Date(purchase.expiresAt);

        daysRemaining = isExpired
          ? 0
          : Math.ceil(
            (new Date(purchase.expiresAt) - now) / (1000 * 60 * 60 * 24)
          );
      }
    }

    res.json({
      success: true,
      project,
      isPurchased,
      isExpired,
      expiresAt,
      daysRemaining,
      renewalCount,
    });
  } catch (error) {
    next(error);
  }
};

// USER: Buy Project
// USER: Buy Project / Renew
export const buyProject = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const user = await User.findById(req.user._id);

    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, "Project not found");

    // ---------- Check existing purchase ----------
    let existing = await Purchase.findOne({
      user: user._id,
      project: project._id,
    });

    const now = new Date();
    const isRenewal = existing && now > new Date(existing.expiresAt);

    // Already purchased AND still active → block
    if (existing && !isRenewal) {
      throw new ApiError(
        400,
        `Already purchased. Valid until ${new Date(
          existing.expiresAt
        ).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}`
      );
    }

    // ---------- Stars check ----------
    if (user.stars < project.price) {
      throw new ApiError(
        400,
        `Not enough stars. Need ${project.price}, you have ${user.stars}`
      );
    }

    // ============================================================
    // ⬇️ EXPIRY: 1 YEAR FROM NOW
    // ============================================================
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);


    // ⬇️ YE HATAO (testing wala)
    // const expiresAt = new Date();
    // expiresAt.setMinutes(expiresAt.getMinutes() + 1);
    // ---------- Deduct stars ----------
    user.stars -= project.price;

    let purchase;

    if (isRenewal && existing) {
      // ========== RENEWAL ==========
      existing.expiresAt = expiresAt;
      existing.isActive = true;
      existing.starsSpent = project.price;
      existing.renewalCount += 1;
      existing.lastRenewedAt = now;
      existing.renewalHistory.push({
        starsSpent: project.price,
        renewedAt: now,
        expiresAt,
      });
      purchase = await existing.save();
    } else {
      // ========== NEW PURCHASE ==========
      purchase = await Purchase.create({
        user: user._id,
        project: project._id,
        starsSpent: project.price,
        expiresAt,
        isActive: true,
      });
      user.purchasedProjects.push(project._id);

      await Project.findByIdAndUpdate(project._id, {
        $inc: { purchases: 1 },
      });
    }

    await user.save();

    res.json({
      success: true,
      isRenewal,
      message: isRenewal
        ? "Access renewed successfully!"
        : "Purchase successful!",
      remainingStars: user.stars,
      purchase,
      expiresAt,
      validityDays: 365,
    });
  } catch (error) {
    next(error);
  }
};

// USER: Download ZIP
// USER: Download ZIP
export const downloadProject = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const purchase = await Purchase.findOne({
      user: req.user._id,
      project: projectId,
    });

    if (!purchase) {
      throw new ApiError(403, "You must purchase this project first");
    }

    // ============================================================
    // ⬇️ EXPIRY CHECK — YE ZAROORI HAI
    // ============================================================
    if (new Date() > new Date(purchase.expiresAt)) {
      throw new ApiError(
        403,
        `Your access expired on ${new Date(
          purchase.expiresAt
        ).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}. Please renew to download.`
      );
    }

    if (!purchase.isActive) {
      throw new ApiError(403, "Access is not active. Please renew.");
    }

    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, "Project not found");

    // Generate signed URL (5 min valid)
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: project.zipKey,
      ResponseContentDisposition: `attachment; filename="${project.title}.zip"`,
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    // Increment download count
    project.downloads += 1;
    await project.save();

    res.json({
      success: true,
      downloadUrl: signedUrl,
      expiresAt: purchase.expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

// USER: My Purchases
export const myPurchases = async (req, res, next) => {
  try {
    const {
      search = "",
      priceFilter = "all",
      statusFilter = "all",   // all | active | expired
      sortBy = "newest",
      page = 1,
      limit = 10,
    } = req.query;

    // ---------- Base filter ----------
    const filter = { user: req.user._id };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "price-high": { starsSpent: -1 },
      "price-low": { starsSpent: 1 },
      "expiry-soon": { expiresAt: 1 },   // ⬅️ NEW
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Aggregation Pipeline ----------
    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "projects",
          localField: "project",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: { path: "$project", preserveNullAndEmptyArrays: false } },
    ];

    // ---------- Search (project title/description) ----------
    if (search.trim()) {
      const q = search.trim();
      pipeline.push({
        $match: {
          $or: [
            { "project.title": { $regex: q, $options: "i" } },
            { "project.description": { $regex: q, $options: "i" } },
          ],
        },
      });
    }

    // ---------- Price filter ----------
    if (priceFilter === "low") {
      pipeline.push({ $match: { starsSpent: { $lte: 50 } } });
    } else if (priceFilter === "mid") {
      pipeline.push({ $match: { starsSpent: { $gt: 50, $lte: 200 } } });
    } else if (priceFilter === "high") {
      pipeline.push({ $match: { starsSpent: { $gt: 200 } } });
    }

    // ---------- Status filter (active/expired) ----------
    const now = new Date();
    if (statusFilter === "active") {
      pipeline.push({ $match: { expiresAt: { $gt: now } } });
    } else if (statusFilter === "expired") {
      pipeline.push({ $match: { expiresAt: { $lte: now } } });
    }

    // ============================================================
    // IMPORTANT: Add computed fields BEFORE count
    // ============================================================
    pipeline.push({
      $addFields: {
        isExpired: { $lte: ["$expiresAt", now] },
        daysRemaining: {
          $cond: {
            if: { $lte: ["$expiresAt", now] },
            then: 0,
            else: {
              $ceil: {
                $divide: [
                  { $subtract: ["$expiresAt", now] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
          },
        },
        // Determine if expiring soon (within 30 days)
        isExpiringSoon: {
          $and: [
            { $gt: ["$expiresAt", now] },
            {
              $lte: [
                "$expiresAt",
                new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
              ],
            },
          ],
        },
      },
    });

    // ---------- Count total ----------
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Purchase.aggregate(countPipeline);
    const totalCount = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Fetch paginated data ----------
    const dataPipeline = [
      ...pipeline,
      { $sort: sort },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          _id: 1,
          starsSpent: 1,
          createdAt: 1,
          user: 1,
          // ⬇️ EXPIRY FIELDS (YE ZAROORI HAIN)
          expiresAt: 1,
          isActive: 1,
          isExpired: 1,
          daysRemaining: 1,
          isExpiringSoon: 1,
          renewalCount: 1,
          lastRenewedAt: 1,
          project: {
            _id: "$project._id",
            title: "$project.title",
            description: "$project.description",
            thumbnail: "$project.thumbnail",
            price: "$project.price",
            fileSize: "$project.fileSize",
            category: "$project.category",
            techStack: "$project.techStack",
          },
        },
      },
    ];

    const purchases = await Purchase.aggregate(dataPipeline);

    // ============================================================
    // Global stats (UNFILTERED by search/price/status)
    // ============================================================
    const statsAgg = await Purchase.aggregate([
      { $match: { user: req.user._id } },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                starsSpent: { $sum: "$starsSpent" },
              },
            },
          ],
          active: [
            { $match: { expiresAt: { $gt: now } } },
            { $count: "count" },
          ],
          expired: [
            { $match: { expiresAt: { $lte: now } } },
            { $count: "count" },
          ],
          expiringSoon: [
            {
              $match: {
                expiresAt: {
                  $gt: now,
                  $lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
                },
              },
            },
            { $count: "count" },
          ],
        },
      },
    ]);

    const stats = statsAgg[0] || {};
    const overall = stats.overall?.[0] || {};

    res.json({
      success: true,
      purchases,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      stats: {
        total: overall.total || 0,
        starsSpent: overall.starsSpent || 0,
        active: stats.active?.[0]?.count || 0,
        expired: stats.expired?.[0]?.count || 0,
        expiringSoon: stats.expiringSoon?.[0]?.count || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ADMIN: My Uploads
export const myUploads = async (req, res, next) => {
  try {
    const {
      search = "",
      priceFilter = "all",
      sortBy = "newest",
      page = 1,
      limit = 10,
    } = req.query;

    // ---------- Build filter ----------
    const filter = { uploadedBy: req.user._id };

    // Search by title or description
    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }

    // Price filter
    if (priceFilter === "free") {
      filter.price = 0;
    } else if (priceFilter === "low") {
      filter.price = { $gt: 0, $lte: 50 };
    } else if (priceFilter === "mid") {
      filter.price = { $gt: 50, $lte: 200 };
    } else if (priceFilter === "high") {
      filter.price = { $gt: 200 };
    }

    // ---------- Build sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "downloads-high": { downloads: -1 },
      "downloads-low": { downloads: 1 },
      "price-high": { price: -1 },
      "price-low": { price: 1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [projects, totalCount] = await Promise.all([
      Project.find(filter).sort(sort).skip(skip).limit(limitNum),
      Project.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Global stats (unfiltered) ----------
    const [totalAll, downloadsAll] = await Promise.all([
      Project.countDocuments({ uploadedBy: req.user._id }),
      Project.aggregate([
        { $match: { uploadedBy: req.user._id } },
        { $group: { _id: null, total: { $sum: "$downloads" } } },
      ]),
    ]);

    const earningsAll = await Project.aggregate([
      { $match: { uploadedBy: req.user._id } },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: ["$price", "$downloads"] } },
        },
      },
    ]);

    res.json({
      success: true,
      projects,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      stats: {
        totalProjects: totalAll,
        totalDownloads: downloadsAll[0]?.total || 0,
        totalEarnings: earningsAll[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ADMIN: Delete Project
export const deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) throw new ApiError(404, "Project not found");

    await Project.findByIdAndDelete(project._id);
    res.json({ success: true, message: "Project deleted" });
  } catch (error) {
    next(error);
  }
};

// ADMIN: Update project
export const updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      price,
      originalPrice,
      category,
      techStack,
      tags,
      liveLink,
      videoLink,
      githubLink,
      isActive,
      isFeatured,
    } = req.body;

    const project = await Project.findById(id);
    if (!project) throw new ApiError(404, "Project not found");

    // Only owner (admin) can update
    if (project.uploadedBy.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Not authorized to update this project");
    }

    // Update fields (only if provided)
    if (title !== undefined) project.title = title.trim();
    if (description !== undefined) project.description = description.trim();
    if (price !== undefined) project.price = Number(price);
    if (originalPrice !== undefined)
      project.originalPrice = Number(originalPrice);
    if (category !== undefined) project.category = category;
    if (liveLink !== undefined) project.liveLink = liveLink.trim();
    if (videoLink !== undefined) project.videoLink = videoLink.trim();
    if (githubLink !== undefined) project.githubLink = githubLink.trim();
    if (isActive !== undefined) project.isActive = isActive;
    if (isFeatured !== undefined) project.isFeatured = isFeatured;

    // Arrays
    if (techStack !== undefined) {
      project.techStack =
        typeof techStack === "string"
          ? techStack.split(",").map((t) => t.trim()).filter(Boolean)
          : techStack;
    }
    if (tags !== undefined) {
      project.tags =
        typeof tags === "string"
          ? tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
          : tags;
    }

    await project.save();

    res.json({ success: true, project });
  } catch (error) {
    next(error);
  }
};