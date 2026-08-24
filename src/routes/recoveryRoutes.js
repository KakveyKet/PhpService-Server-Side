import { Router } from "express";
import rateLimit from "express-rate-limit";
import { bootstrapSuperAdmin } from "../controllers/recoveryController.js";

const router = Router();

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many recovery attempts. Try again later.",
  },
});

router.use(recoveryLimiter);

router.post("/bootstrap-super-admin", bootstrapSuperAdmin);

export default router;
