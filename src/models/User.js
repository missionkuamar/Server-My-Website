import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },

    password: {
      type: String,
      required: false,
      minlength: 6,
    },

    googleId: { type: String, default: "" },
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "google",
    },
    avatar: { type: String, default: "" },

    role: {
      type: String,
      enum: ["user", "admin", "moderator"],
      default: "user",
    },

    stars: { type: Number, default: 100 },
    purchasedProjects: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    ],

    // ============ DAILY BONUS ============
    lastClaimAt: { type: Date, default: null },
    claimStreak: { type: Number, default: 0 },
    totalClaims: { type: Number, default: 0 },

    // ============ STATUS ============
    status: {
      type: String,
      enum: ["active", "blocked", "banned", "suspended"],
      default: "active",
    },
    blockReason: { type: String, default: "" },
    banReason: { type: String, default: "" },
    suspendedUntil: { type: Date, default: null },

    // ============ ACTIVITY ============
    lastLogin: { type: Date, default: null },
    loginCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.matchPassword = function (entered) {
  if (!this.password) return false;
  return bcrypt.compare(entered, this.password);
};

/* ============================================================
   HELPER: Check if user can claim daily bonus
   ============================================================ */
userSchema.methods.canClaimDaily = function () {
  if (!this.lastClaimAt) return true;
  const now = new Date();
  const last = new Date(this.lastClaimAt);
  const hoursDiff = (now - last) / (1000 * 60 * 60);
  return hoursDiff >= 24;
};

/* ============================================================
   HELPER: Next claim time
   ============================================================ */
userSchema.methods.getNextClaimTime = function () {
  if (!this.lastClaimAt) return null;
  const next = new Date(this.lastClaimAt);
  next.setHours(next.getHours() + 24);
  return next;
};

export default mongoose.model("User", userSchema);