import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    starsSpent: { type: Number, required: true },

    // ============ EXPIRY ============
    expiresAt: {
      type: Date,
      required: true,
      default: () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);   // ⬅️ 1 year default
        return d;
      },
    },
    isActive: { type: Boolean, default: true },

    // ============ RENEWAL ============
    renewalCount: { type: Number, default: 0 },
    lastRenewedAt: { type: Date, default: null },
    renewalHistory: [
      {
        starsSpent: Number,
        renewedAt: { type: Date, default: Date.now },
        expiresAt: Date,
      },
    ],
  },
  { timestamps: true }
);

purchaseSchema.index({ user: 1, project: 1 }, { unique: true });

export default mongoose.model("Purchase", purchaseSchema);