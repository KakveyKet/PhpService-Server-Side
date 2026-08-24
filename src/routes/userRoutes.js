import { Router } from "express";

import {
  createUser,
  listUsers,
  updateUser,
} from "../controllers/userController.js";

import { ROLES } from "../constants/index.js";

import { allowRoles, authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate, allowRoles(ROLES.SUPER_ADMIN));

router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id", updateUser);

export default router;
