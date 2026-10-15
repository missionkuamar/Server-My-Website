import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import generateToken from "../utils/generateToken.js";
import { OAuth2Client } from "google-auth-library";



const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const exists = await User.findOne({ email });
    if (exists) throw new ApiError(400, "User already exists");

    const user = await User.create({ name, email, password, role });
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      throw new ApiError(401, "Invalid email or password");
    }

    // ---------- Check block / ban status ----------
    if (user.status === "banned") {
      throw new ApiError(403, `Account banned. Reason: ${user.banReason || "Contact support"}`);
    }
    if (user.status === "blocked") {
      throw new ApiError(403, `Account blocked. Reason: ${user.blockReason || "Contact support"}`);
    }
    if (user.status === "suspended") {
      if (user.suspendedUntil && new Date() < user.suspendedUntil) {
        throw new ApiError(
          403,
          `Account suspended until ${user.suspendedUntil.toLocaleDateString()}`
        );
      }
      // Auto-unblock after suspension
      user.status = "active";
      user.suspendedUntil = null;
      user.blockReason = "";
    }

    // Update last login
    user.lastLogin = new Date();
    user.loginCount += 1;
    await user.save();

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        stars: user.stars,
        status: user.status,
      },
    });
  } catch (error) {
    next(error);
  }
};




// Change password
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, "Both passwords required");
    }

    if (newPassword.length < 6) {
      throw new ApiError(400, "Password must be at least 6 characters");
    }

    const user = await User.findById(req.user._id);
    if (!user) throw new ApiError(404, "User not found");

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) throw new ApiError(401, "Current password is incorrect");

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    next(error);
  }
};




/* ============================================================
   GOOGLE LOGIN / REGISTER
   ============================================================ */
export const googleAuth = async (req, res, next) => {
  console.log("\n========== GOOGLE AUTH REQUEST ==========");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Origin:", req.headers.origin);
  console.log("GOOGLE_CLIENT_ID exists?", !!process.env.GOOGLE_CLIENT_ID);
  console.log(
    "GOOGLE_CLIENT_ID prefix:",
    process.env.GOOGLE_CLIENT_ID?.substring(0, 20) + "..."
  );

  try {
    const { credential } = req.body;

    if (!credential) {
      console.log("❌ No credential in body");
      throw new ApiError(400, "Google credential missing");
    }

    console.log("✅ Credential received, length:", credential.length);

    // 1. Verify Google token
    console.log("🔍 Verifying token with Google...");
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    console.log("✅ Token verified");
    console.log("   → Email:", email);
    console.log("   → Name:", name);
    console.log("   → Google ID:", googleId);

    if (!email) {
      console.log("❌ No email in Google payload");
      throw new ApiError(400, "Email not found in Google account");
    }

    // 2. Find or create user
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (user) {
      console.log("✅ Existing user found:", user._id);
      console.log("   → Status:", user.status);

      // Block / ban check
      if (user.status === "banned") {
        throw new ApiError(
          403,
          `Account banned. Reason: ${user.banReason || "Contact support"}`
        );
      }
      if (user.status === "blocked") {
        throw new ApiError(
          403,
          `Account blocked. Reason: ${user.blockReason || "Contact support"}`
        );
      }
      if (user.status === "suspended") {
        if (user.suspendedUntil && new Date() < user.suspendedUntil) {
          throw new ApiError(
            403,
            `Account suspended until ${user.suspendedUntil.toLocaleDateString()}`
          );
        }
        user.status = "active";
        user.suspendedUntil = null;
        user.blockReason = "";
      }

      // Link Google if not linked
      if (!user.googleId) {
        console.log("🔗 Linking Google account to existing user");
        user.googleId = googleId;
        user.provider = "google";
      }
      if (!user.avatar && picture) user.avatar = picture;
    } else {
      console.log("🆕 Creating new user...");
      isNewUser = true;
      user = await User.create({
        name: name || email.split("@")[0],
        email: email.toLowerCase(),
        googleId,
        provider: "google",
        avatar: picture || "",
        role: "user",
        stars: 100,
      });
      console.log("✅ New user created:", user._id);
    }

    // 3. Update login stats
    user.lastLogin = new Date();
    user.loginCount += 1;
    await user.save();

    // 4. Generate JWT
    const token = generateToken(user._id);
    console.log("✅ JWT generated for user:", user._id);
    console.log("========== GOOGLE AUTH SUCCESS ==========\n");

    res.json({
      success: true,
      isNewUser,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        stars: user.stars,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (error) {
    console.log("\n❌❌❌ GOOGLE AUTH ERROR ❌❌❌");
    console.log("Error name:", error.name);
    console.log("Error message:", error.message);
    console.log("Error stack:", error.stack?.split("\n")[0]);
    console.log("==========================================\n");

    if (error.message?.includes("Token used too late")) {
      return next(
        new ApiError(401, "Google token expired. Please try again.")
      );
    }
    if (
      error.message?.includes("Invalid token") ||
      error.message?.includes("Wrong number of segments")
    ) {
      return next(new ApiError(401, "Invalid Google token"));
    }
    if (error.message?.includes("audience")) {
      return next(
        new ApiError(
          401,
          "Google Client ID mismatch. Check server .env GOOGLE_CLIENT_ID matches client VITE_GOOGLE_CLIENT_ID"
        )
      );
    }

    next(error);
  }
};

/* ============================================================
   GET CURRENT USER (for refresh)
   ============================================================ */
export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) throw new ApiError(404, "User not found");

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        stars: user.stars,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ============================================================
   UPDATE PROFILE
   ============================================================ */
export const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) throw new ApiError(404, "User not found");

    // Only name can be updated for Google users
    if (name && name.trim()) {
      user.name = name.trim();
    }

    await user.save();

    res.json({
      success: true,
      message: "Profile updated",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        stars: user.stars,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};




