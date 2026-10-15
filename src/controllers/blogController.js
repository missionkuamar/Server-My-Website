import Blog from "../models/Blog.js";
import ApiError from "../utils/ApiError.js";

/* ---------- Slug generator ---------- */
const generateSlug = (title) =>
  title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") +
  "-" +
  Date.now();

/* ============================================================
   ADMIN: Create blog
   ============================================================ */
export const createBlog = async (req, res, next) => {
  try {
    const {
      title,
      excerpt,
      content,
      tags,
      status,
      liveLink,
      videoLink,
      githubLink,
      category,
      isFeatured,
      readTime,
    } = req.body;

    if (!title || !excerpt || !content) {
      throw new ApiError(400, "Title, excerpt, and content are required");
    }

    const thumbnailFile = req.files?.thumbnail?.[0];
    const galleryFiles = req.files?.gallery || [];

    if (galleryFiles.length > 20) {
      throw new ApiError(400, "Max 20 gallery images allowed");
    }

    // Parse tags
    const parsedTags = tags
      ? typeof tags === "string"
        ? tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
        : tags
      : [];

    // Build gallery
    const gallery = galleryFiles.map((f) => ({
      url: f.location,
      key: f.key,
      caption: "",
    }));

    const blog = await Blog.create({
      title: title.trim(),
      slug: generateSlug(title),
      excerpt: excerpt.trim(),
      content: content.trim(),

      thumbnail: thumbnailFile?.location || "",
      thumbnailKey: thumbnailFile?.key || "",
      gallery,

      liveLink: liveLink?.trim() || "",
      videoLink: videoLink?.trim() || "",
      githubLink: githubLink?.trim() || "",

      tags: parsedTags,
      category: category || "tutorial",
      status: status || "draft",
      isFeatured: isFeatured === "true" || isFeatured === true,
      readTime: Number(readTime) || 5,

      author: req.user._id,
    });

    res.status(201).json({ success: true, blog });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   PUBLIC: Get all published blogs
   ============================================================ */
export const getBlogs = async (req, res, next) => {
  try {
    const {
      search = "",
      category = "all",
      tag = "",
      sortBy = "newest",
      page = 1,
      limit = 9,
    } = req.query;

    // ---------- Filter ----------
    const filter = { status: "published" };

    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { excerpt: { $regex: q, $options: "i" } },
        { tags: { $in: [new RegExp(q, "i")] } },
      ];
    }

    if (category !== "all") filter.category = category;
    if (tag) filter.tags = tag;

    // ---------- Sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      popular: { views: -1 },
      liked: { likes: -1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 9));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [blogs, totalCount] = await Promise.all([
      Blog.find(filter)
        .populate("author", "name")
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .select("-content"), // content skip karo list me
      Blog.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- All categories (for filter chips) ----------
    const categoriesAgg = await Blog.aggregate([
      { $match: { status: "published" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const categories = categoriesAgg.map((c) => ({
      name: c._id || "other",
      count: c.count,
    }));

    // ---------- Featured blog ----------
    const featuredBlog = await Blog.findOne({
      status: "published",
      isFeatured: true,
    })
      .sort({ createdAt: -1 })
      .select("title slug excerpt thumbnail category readTime views likes");

    res.json({
      success: true,
      blogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      categories,
      featuredBlog,
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   ADMIN: Get all blogs (draft + published)
   ============================================================ */
export const getAllBlogsAdmin = async (req, res, next) => {
  try {
    const {
      search = "",
      status = "all",
      category = "all",
      featured = "all",
      sortBy = "newest",
      page = 1,
      limit = 10,
    } = req.query;

    // ---------- Filter ----------
    const filter = {};

    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { excerpt: { $regex: q, $options: "i" } },
        { tags: { $in: [new RegExp(q, "i")] } },
      ];
    }

    if (status !== "all") filter.status = status;
    if (category !== "all") filter.category = category;
    if (featured === "yes") filter.isFeatured = true;
    if (featured === "no") filter.isFeatured = false;

    // ---------- Sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "views-high": { views: -1 },
      "views-low": { views: 1 },
      title: { title: 1 },
      "read-time": { readTime: -1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [blogs, totalCount] = await Promise.all([
      Blog.find(filter)
        .populate("author", "name email")
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Blog.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Global stats ----------
    const [totalAll, publishedCount, draftCount, viewsAgg, featuredCount] =
      await Promise.all([
        Blog.countDocuments(),
        Blog.countDocuments({ status: "published" }),
        Blog.countDocuments({ status: "draft" }),
        Blog.aggregate([
          { $group: { _id: null, total: { $sum: "$views" } } },
        ]),
        Blog.countDocuments({ isFeatured: true }),
      ]);

    res.json({
      success: true,
      blogs,
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
        published: publishedCount,
        draft: draftCount,
        views: viewsAgg[0]?.total || 0,
        featured: featuredCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   Get single blog by slug
   ============================================================ */
export const getBlogBySlug = async (req, res, next) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug }).populate(
      "author",
      "name"
    );
    if (!blog) throw new ApiError(404, "Blog not found");

    // Increment views
    blog.views += 1;
    await blog.save();

    res.json({ success: true, blog });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   ADMIN: Update blog
   ============================================================ */
export const updateBlog = async (req, res, next) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) throw new ApiError(404, "Blog not found");

    const {
      title,
      excerpt,
      content,
      tags,
      status,
      liveLink,
      videoLink,
      githubLink,
      category,
      isFeatured,
      readTime,
    } = req.body;

    const thumbnailFile = req.files?.thumbnail?.[0];
    const galleryFiles = req.files?.gallery || [];

    if (title !== undefined) blog.title = title.trim();
    if (excerpt !== undefined) blog.excerpt = excerpt.trim();
    if (content !== undefined) blog.content = content.trim();
    if (liveLink !== undefined) blog.liveLink = liveLink.trim();
    if (videoLink !== undefined) blog.videoLink = videoLink.trim();
    if (githubLink !== undefined) blog.githubLink = githubLink.trim();
    if (category !== undefined) blog.category = category;
    if (status !== undefined) blog.status = status;
    if (isFeatured !== undefined)
      blog.isFeatured = isFeatured === "true" || isFeatured === true;
    if (readTime !== undefined) blog.readTime = Number(readTime);

    if (tags !== undefined) {
      blog.tags =
        typeof tags === "string"
          ? tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
          : tags;
    }

    if (thumbnailFile) {
      blog.thumbnail = thumbnailFile.location;
      blog.thumbnailKey = thumbnailFile.key;
    }

    if (galleryFiles.length > 0) {
      const newGallery = galleryFiles.map((f) => ({
        url: f.location,
        key: f.key,
        caption: "",
      }));
      blog.gallery = [...blog.gallery, ...newGallery];
    }

    await blog.save();

    res.json({ success: true, blog });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   ADMIN: Delete blog
   ============================================================ */
export const deleteBlog = async (req, res, next) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) throw new ApiError(404, "Blog not found");
    res.json({ success: true, message: "Blog deleted" });
  } catch (error) {
    next(error);
  }
};



// PUBLIC: Increment likes
export const incrementLike = async (req, res, next) => {
  try {
    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: 1 } },
      { returnDocument: "after" }
    );
    if (!blog) throw new ApiError(404, "Blog not found");
    res.json({ success: true, likes: blog.likes });
  } catch (error) {
    next(error);
  }
};

// PUBLIC: Get related blogs (same category, excluding current)
export const getRelatedBlogs = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const blog = await Blog.findOne({ slug });
    if (!blog) throw new ApiError(404, "Blog not found");

    const related = await Blog.find({
      _id: { $ne: blog._id },
      status: "published",
      $or: [
        { category: blog.category },
        { tags: { $in: blog.tags } },
      ],
    })
      .limit(3)
      .populate("author", "name")
      .select("title slug excerpt thumbnail category readTime createdAt views");

    res.json({ success: true, blogs: related });
  } catch (error) {
    next(error);
  }
};