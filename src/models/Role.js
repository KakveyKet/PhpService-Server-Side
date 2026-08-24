import mongoose from 'mongoose';
import { ROLES } from '../constants/index.js';

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
      unique: true,
      uppercase: true,
      trim: true
    },
    displayName: { type: String, required: true, trim: true },
    permissions: [{ type: String, trim: true }],
    isSystemRole: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
  },
  { timestamps: true }
);

export default mongoose.model('Role', roleSchema);
