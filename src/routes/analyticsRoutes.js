import express from "express";
import {
  getRevenueChart,
  getUserGrowthChart,
  getSalesChart,
  getOverviewStats,
  getTopProjects,
  getRoleDistribution,
} from "../controllers/analyticsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = express.Router();

// All analytics routes are admin-only
router.use(protect, authorize("admin"));

router.get("/overview", getOverviewStats);
router.get("/revenue", getRevenueChart);
router.get("/users-growth", getUserGrowthChart);
router.get("/sales", getSalesChart);
router.get("/top-projects", getTopProjects);
router.get("/roles", getRoleDistribution);

export default router;