import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderId: { type: String, required: true, unique: true },
    paymentId: { type: String },
    amount: { type: Number, required: true },       // in paise (₹100 = 10000)
    currency: { type: String, default: "INR" },
    stars: { type: Number, required: true },
    plan: { type: String, required: true },
    status: {
      type: String,
      enum: ["created", "paid", "failed"],
      default: "created",
    },
    signature: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);