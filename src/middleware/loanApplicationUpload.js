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
    files: 4,
    fileSize: 8 * 1024 * 1024,
    fields: 20
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new AppError('Application images must be JPG, PNG or WEBP', 422));
      return;
    }

    callback(null, true);
  }
});

export const uploadLoanApplicationFiles = upload.fields([
  { name: 'frontIdCard', maxCount: 1 },
  { name: 'backIdCard', maxCount: 1 },
  { name: 'selfieWithId', maxCount: 1 },
  { name: 'signature', maxCount: 1 }
]);
