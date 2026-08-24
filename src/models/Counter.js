import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  sequence: { type: Number, default: 0 }
});

export default mongoose.model('Counter', counterSchema);
