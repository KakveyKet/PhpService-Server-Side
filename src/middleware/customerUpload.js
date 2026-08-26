import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new AppError('Identity images must be JPG, PNG or WEBP', 422));
      return;
    }

    callback(null, true);
  }
});

export const uploadSelfieWithId = upload.single('selfieWithId');

export const uploadIdentityImages = upload.fields([
  { name: 'frontIdCard', maxCount: 1 },
  { name: 'backIdCard', maxCount: 1 },
  { name: 'selfieWithId', maxCount: 1 }
]);
