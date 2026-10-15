import jwt from "jsonwebtoken";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

export const protect = async (req, res, next) => {
  try {
    let token = req.headers.authorization?.startsWith("Bearer")
      ? req.headers.authorization.split(" ")[1]
      : req.cookies?.token;

    if (!token) throw new ApiError(401, "Not authorized, no token");

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) throw new ApiError(401, "User not found");
    next();
  } catch (error) {
    next(error);
  }
};