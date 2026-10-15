import express from "express";
import {
  getPlans,
  createOrder,
  verifyPayment,
  myPayments,
} from "../controllers/paymentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/plans", getPlans);
router.post("/create-order", protect, createOrder);
router.post("/verify", protect, verifyPayment);
router.get("/my-payments", protect, myPayments);

export default router;