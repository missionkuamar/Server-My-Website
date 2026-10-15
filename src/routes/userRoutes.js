import express from "express";
import {
  getAllUsers,
  getUserDetails,
  blockUser,
  unblockUser,
  banUser,
  suspendUser,
  updateUserRole,
  adjustStars,
  deleteUser,
  bulkAction,
  getDailyBonusStatus,
  claimDailyBonus,
} from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = express.Router();

/* ============================================================
   USER-LEVEL ROUTES (any logged-in user)
   ⚠️ These MUST come BEFORE admin-only routes
   ============================================================ */

// Daily Bonus — any logged-in user
router.get("/daily-bonus", protect, getDailyBonusStatus);
router.post("/daily-bonus/claim", protect, claimDailyBonus);

// Own profile
router.get("/me", protect, (req, res) => {
  res.json({ success: true, user: req.user });
});

/* ============================================================
   ADMIN-ONLY ROUTES
   ============================================================ */

// List all users
router.get("/", protect, authorize("admin"), getAllUsers);

// Bulk action
router.post("/bulk-action", protect, authorize("admin"), bulkAction);

// Specific user by ID (LAST me — warna dynamic route match karega)
router.get("/:id", protect, authorize("admin"), getUserDetails);
router.put("/:id/block", protect, authorize("admin"), blockUser);
router.put("/:id/unblock", protect, authorize("admin"), unblockUser);
router.put("/:id/ban", protect, authorize("admin"), banUser);
router.put("/:id/suspend", protect, authorize("admin"), suspendUser);
router.put("/:id/role", protect, authorize("admin"), updateUserRole);
router.put("/:id/stars", protect, authorize("admin"), adjustStars);
router.delete("/:id", protect, authorize("admin"), deleteUser);

export default router;