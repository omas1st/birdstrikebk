const mongoose = require('mongoose');

const setupSchema = new mongoose.Schema(
  {
    pair: {
      type: String,
      required: true,
    },
    strategy: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    flaggedAt: Date,
    restoredAt: Date,
  },
  { timestamps: true }
);

// Compound index to prevent duplicate active setups with same pair+strategy
setupSchema.index({ pair: 1, strategy: 1, isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

module.exports = mongoose.model('Setup', setupSchema);