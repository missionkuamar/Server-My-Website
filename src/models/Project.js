import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },

    // Pricing
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: 0 }, // optional (discount dikhane ke liye)

    // ============ IMAGES ============
    thumbnail: { type: String, default: "" },       // single main image
    thumbnailKey: { type: String, default: "" },    // S3 key for thumbnail
    gallery: [
      {
        url: { type: String, required: true },
        key: { type: String, required: true },
        caption: { type: String, default: "" },
      },
    ], // multiple images (max 20)

    // ============ ZIP FILE ============
    zipUrl: { type: String, required: true },
    zipKey: { type: String, required: true },
    fileSize: { type: Number },

    // ============ TECH STACK ============
    techStack: [{ type: String, trim: true }], // ["react", "tailwind", "next.js"]

    // ============ LINKS ============
    liveLink: { type: String, default: "" },     // deployed project URL
    videoLink: { type: String, default: "" },    // youtube demo link
    githubLink: { type: String, default: "" },   // optional

    // ============ CATEGORY & TAGS ============
    category: {
      type: String,
      enum: ["web", "mobile", "ai", "ecommerce", "portfolio", "blog", "saas", "other"],
      default: "web",
    },
    tags: [{ type: String, trim: true }], // search tags

    // ============ STATUS ============
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },

    // ============ STATS ============
    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },

    // ============ OWNER ============
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Index for search
projectSchema.index({ title: "text", description: "text", techStack: "text" });

export default mongoose.model("Project", projectSchema);