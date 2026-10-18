import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import blogRoutes from "./routes/blogRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";

const app = express();

/* ---------- Allowed Origins ---------- */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "https://invoicehub.fun",
  "https://www.codewithmission.site",
  "https://codewithmission.site",
  "https://www.invoicehub.fun",
  "https://www.codewithmission.site",
  "https://codewithmission.site",
  "https://client-my-website-five.vercel.app", // ✅ trailing slash removed
];

// Env var se bhi add karo (Render pe set karoge)
if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(",").forEach((url) => {
    const trimmed = url.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

/* ---------- CORS ---------- */
app.use(
  cors({
    origin: (origin, callback) => {
      // Postman / same-origin requests (no origin) ko allow karo
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ---------- Body & Cookies ---------- */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ---------- Health Check (Render ke liye useful) ---------- */
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Backend is running 🚀" });
});

/* ---------- Routes ---------- */
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/analytics", analyticsRoutes);

/* ---------- Error Handlers ---------- */
app.use(notFound);
app.use(errorHandler);

export default app;
