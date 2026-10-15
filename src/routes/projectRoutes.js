import express from "express";
import {
  uploadProject,
  getProjects,
  getProjectById,
  buyProject,
  downloadProject,
  myPurchases,
  myUploads,
  deleteProject,
  updateProject
} from "../controllers/projectController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();

// Public
router.get("/", getProjects);
router.put("/:id", protect, authorize("admin"), updateProject);

// Protected user routes (need auth)
router.get("/my-purchases", protect, myPurchases);
router.post("/:projectId/buy", protect, buyProject);
router.get("/:projectId/download", protect, downloadProject);

// Admin routes
router.get("/my-uploads", protect, authorize("admin"), myUploads);

router.post(
  "/upload",
  protect,
  authorize("admin"),
  upload.fields([
    { name: "zip", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
    { name: "gallery", maxCount: 20 },
  ]),
  uploadProject
);
router.delete("/:id", protect, authorize("admin"), deleteProject);

// Keep this LAST (dynamic param)
router.get("/:id", protect, getProjectById);

export default router;