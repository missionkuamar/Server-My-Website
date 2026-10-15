import express from "express";
import {
  createBlog,
  getBlogs,
  getAllBlogsAdmin,
  getRelatedBlogs,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  incrementLike,
} from "../controllers/blogController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();


router.get("/:slug/related", getRelatedBlogs);
// Public routes
router.get("/", getBlogs);
router.get("/:slug", getBlogBySlug);
router.post("/:id/like", incrementLike);   // ⬅️ NEW

// Admin routes
router.get("/admin/all", protect, authorize("admin"), getAllBlogsAdmin);
router.post("/", protect, authorize("admin"), upload.fields([
  { name: "thumbnail", maxCount: 1 },
  { name: "gallery", maxCount: 20 },
]), createBlog);

router.put("/:id", protect, authorize("admin"), upload.fields([
  { name: "thumbnail", maxCount: 1 },
  { name: "gallery", maxCount: 20 },
]), updateBlog);

router.delete("/:id", protect, authorize("admin"), deleteBlog);

export default router;