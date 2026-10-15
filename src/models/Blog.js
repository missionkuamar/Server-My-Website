import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    excerpt: { type: String, required: true, maxlength: 300 },
    content: { type: String, required: true },

    // ============ IMAGES ============
    thumbnail: { type: String, default: "" },       // main cover
    thumbnailKey: { type: String, default: "" },    // S3 key
    gallery: [
      {
        url: { type: String, required: true },
        key: { type: String, required: true },
        caption: { type: String, default: "" },
      },
    ],

    // ============ LINKS ============
    liveLink: { type: String, default: "" },      // demo/project link
    videoLink: { type: String, default: "" },     // YouTube video
    githubLink: { type: String, default: "" },    // source code

    // ============ META ============
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tags: [{ type: String, trim: true, lowercase: true }],
    category: {
      type: String,
      enum: ["tutorial", "news", "review", "guide", "case-study", "other"],
      default: "tutorial",
    },

    // ============ STATUS ============
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    isFeatured: { type: Boolean, default: false },

    // ============ STATS ============
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    readTime: { type: Number, default: 5 }, // in minutes
  },
  { timestamps: true }
);

blogSchema.index({ title: "text", excerpt: "text", content: "text", tags: "text" });

export default mongoose.model("Blog", blogSchema);