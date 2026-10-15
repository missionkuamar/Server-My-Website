import crypto from "crypto";
import razorpay from "../config/razorpay.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

// ==========================================
// STARS PLANS — Yahan se customize karo
// ==========================================
export const STAR_PLANS = [
  {
    id: "silver",
    name: "Silver",
    description: "Perfect for trying out",
    price: 100,      // ₹100
    stars: 199,      // 199 stars
    bonus: 0,
    popular: false,
  },
  {
    id: "gold",
    name: "Gold",
    description: "Best value for money",
    price: 500,      // ₹500
    stars: 1099,     // 1099 stars (bonus 99)
    bonus: 99,
    popular: true,
  },
  {
    id: "platinum",
    name: "Platinum",
    description: "For serious buyers",
    price: 1000,     // ₹1000
    stars: 2499,     // 2499 stars (bonus 499)
    bonus: 499,
    popular: false,
  },
];

// ==========================================
// GET: All Plans (public)
// ==========================================
export const getPlans = (req, res) => {
  res.json({ success: true, plans: STAR_PLANS });
};

// ==========================================
// POST: Create Razorpay Order
// ==========================================
export const createOrder = async (req, res, next) => {
  try {
    const { planId } = req.body;

    const plan = STAR_PLANS.find((p) => p.id === planId);
    if (!plan) throw new ApiError(400, "Invalid plan");

    // Razorpay accepts amount in paise (₹1 = 100 paise)
    const options = {
      amount: plan.price * 100,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId: req.user._id.toString(),
        planId: plan.id,
        stars: plan.stars,
      },
    };

    const order = await razorpay.orders.create(options);

    // Save payment record
    await Payment.create({
      user: req.user._id,
      orderId: order.id,
      amount: plan.price * 100,
      stars: plan.stars,
      plan: plan.id,
      status: "created",
    });

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      key: process.env.RAZORPAY_KEY_ID,
      plan,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// POST: Verify Payment & Credit Stars
// ==========================================
export const verifyPayment = async (req, res, next) => {
  console.log("\n========== VERIFY PAYMENT CALLED ==========");
  console.log("Body:", req.body);
  console.log("User:", req.user?._id);
  console.log("RAZORPAY_KEY_SECRET exists?", !!process.env.RAZORPAY_KEY_SECRET);
  console.log("RAZORPAY_KEY_SECRET length:", process.env.RAZORPAY_KEY_SECRET?.length);

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new ApiError(400, "Missing payment details");
    }

    console.log("Step 1: Body validation passed ✅");
    console.log("Order ID:", razorpay_order_id);
    console.log("Payment ID:", razorpay_payment_id);

    // Check if crypto is imported
    console.log("Step 2: crypto module check");
    console.log("typeof crypto:", typeof crypto);
    console.log("crypto.createHmac exists?", typeof crypto?.createHmac);

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    console.log("Step 3: Creating signature for body:", body);

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    console.log("Expected Signature:", expectedSignature);
    console.log("Received Signature:", razorpay_signature);
    console.log("Signature match?", expectedSignature === razorpay_signature);

    const isValid = expectedSignature === razorpay_signature;

    if (!isValid) {
      console.log("Step 4: Signature INVALID ❌");
      await Payment.findOneAndUpdate(
        { orderId: razorpay_order_id },
        { status: "failed" }
      );
      throw new ApiError(400, "Invalid payment signature");
    }

    console.log("Step 5: Signature valid ✅");

    // Find payment record
    console.log("Step 6: Finding payment record...");
    const payment = await Payment.findOne({ orderId: razorpay_order_id });
    console.log("Payment found?", !!payment);
    if (payment) {
      console.log("Payment details:", {
        _id: payment._id,
        user: payment.user,
        stars: payment.stars,
        status: payment.status,
        amount: payment.amount,
      });
    }

    if (!payment) throw new ApiError(404, "Order not found");
    if (payment.status === "paid") {
      console.log("Step 7: Payment already processed ❌");
      throw new ApiError(400, "Payment already processed");
    }

    console.log("Step 7: Finding user...");
    const user = await User.findById(payment.user);
    console.log("User found?", !!user);
    if (user) {
      console.log("User details:", {
        _id: user._id,
        name: user.name,
        email: user.email,
        stars: user.stars,
      });
    }

    if (!user) throw new ApiError(404, "User not found");

    console.log("Step 8: Crediting stars...");
    user.stars += payment.stars;
    await user.save();
    console.log("Stars credited ✅ New balance:", user.stars);

    console.log("Step 9: Updating payment status...");
    payment.status = "paid";
    payment.paymentId = razorpay_payment_id;
    payment.signature = razorpay_signature;
    await payment.save();
    console.log("Payment updated ✅");

    console.log("========== VERIFY PAYMENT SUCCESS ==========\n");

    res.json({
      success: true,
      message: `Successfully added ${payment.stars} stars!`,
      starsAdded: payment.stars,
      newBalance: user.stars,
    });
  } catch (error) {
    console.log("\n❌❌❌ VERIFY PAYMENT ERROR ❌❌❌");
    console.log("Error name:", error.name);
    console.log("Error message:", error.message);
    console.log("Error stack:", error.stack);
    console.log("===========================================\n");
    next(error);
  }
};

// ==========================================
// GET: My Payment History
// ==========================================
export const myPayments = async (req, res, next) => {
  try {
    const {
      search = "",
      plan = "all",
      sortBy = "newest",
      page = 1,
      limit = 10,
    } = req.query;

    // ---------- Filter ----------
    const filter = { user: req.user._id, status: "paid" };

    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { orderId: { $regex: q, $options: "i" } },
        { paymentId: { $regex: q, $options: "i" } },
        { plan: { $regex: q, $options: "i" } },
      ];
    }

    if (plan !== "all") filter.plan = plan;

    // ---------- Sort ----------
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "amount-high": { amount: -1 },
      "amount-low": { amount: 1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    // ---------- Pagination ----------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // ---------- Query ----------
    const [payments, totalCount] = await Promise.all([
      Payment.find(filter).sort(sort).skip(skip).limit(limitNum),
      Payment.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // ---------- Global stats (unfiltered) ----------
    const [totalSpentAgg, totalStarsAgg, totalCountAgg] = await Promise.all([
      Payment.aggregate([
        { $match: { user: req.user._id, status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Payment.aggregate([
        { $match: { user: req.user._id, status: "paid" } },
        { $group: { _id: null, total: { $sum: "$stars" } } },
      ]),
      Payment.countDocuments({ user: req.user._id, status: "paid" }),
    ]);

    res.json({
      success: true,
      payments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      stats: {
        totalSpent: (totalSpentAgg[0]?.total || 0) / 100,
        totalStars: totalStarsAgg[0]?.total || 0,
        transactions: totalCountAgg,
      },
    });
  } catch (error) {
    next(error);
  }
};