import multer from "multer";
import multerS3 from "multer-s3";
import s3 from "../config/s3.js";
import path from "path";

/* ============ ZIP UPLOAD (single) ============ */
const zipUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(
        null,
        `projects/zips/${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}${ext}`
      );
    },
  }),
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed" ||
      file.originalname.endsWith(".zip")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only ZIP files allowed"), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

/* ============ IMAGE UPLOAD (thumbnail + gallery) ============ */
const imageUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(
        null,
        `projects/images/${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}${ext}`
      );
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed"), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per image
});

/* ============ COMBINED FIELDS UPLOADER ============ */
const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      let folder = "projects/other";

      if (file.fieldname === "zip") folder = "projects/zips";
      else if (file.fieldname === "thumbnail") folder = "projects/thumbnails";
      else if (file.fieldname === "gallery") folder = "projects/gallery";

      cb(
        null,
        `${folder}/${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}${ext}`
      );
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // max 100 MB (per file)
    files: 25, // thumbnail (1) + gallery (20) + zip (1) + buffer
  },
});

export { zipUpload, imageUpload };
export default upload;